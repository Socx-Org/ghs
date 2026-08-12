import type { DailyPcc, PccRepository, PccSource, RoundDifferentialInput } from "../data/pcc.repository.ts";

// PCC business logic lives here (ADR-060) -- the repository only reads
// and writes rows; it knows nothing about the -1..3 bucketing formula or
// input validation.

export class InvalidPccInputError extends Error {}

const PCC_MIN = -1;
const PCC_MAX = 3;

// Real WHS Playing Conditions Calculation, confirmed against legacy's
// live services/pcc.ts during Phase 2 discovery: the average, across
// every round played at a tee-configuration on a given day, of
// (113/slope) * (adjusted_gross_score - course_rating) -- i.e. each
// round's own differential *before* PCC is subtracted -- bucketed to an
// integer in -1..3.
export function derivePccFromRounds(rows: RoundDifferentialInput[]): number {
  if (rows.length === 0) return 0;

  const average =
    rows.reduce((sum, row) => {
      return sum + (113 / row.slopeRating) * (row.adjustedGrossScore - row.courseRating);
    }, 0) / rows.length;

  if (average <= -1) return -1;
  if (average < 0.5) return 0;
  if (average < 1.5) return 1;
  if (average < 2.5) return 2;
  return 3;
}

// Accepts either a full ISO date-time or a plain YYYY-MM-DD date and
// normalises to YYYY-MM-DD. Throws on anything else.
export function getPlayedOnDate(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidPccInputError(`playedOn must be a valid ISO date or date-time, got ${JSON.stringify(raw)}`);
  }
  return parsed.toISOString().slice(0, 10);
}

export interface PccService {
  getOrCreateDailyPcc(teeConfigurationId: string, playedOnRaw: string): Promise<DailyPcc>;
  // pccOverride: a specific -1..3 integer to force ("override"), or null
  // to calculate fresh from the day's rounds ("calculated"). Either way,
  // every affected round's pcc/score_differential is rewritten in one
  // transaction.
  calculateOrOverride(
    teeConfigurationId: string,
    playedOnRaw: string,
    pccOverride: number | null,
    updatedBy: string | null,
  ): Promise<{ dailyPcc: DailyPcc; updatedRounds: number; affectedPlayerIds: string[] }>;
}

function assertValidOverride(value: number): void {
  if (!Number.isInteger(value) || value < PCC_MIN || value > PCC_MAX) {
    throw new InvalidPccInputError(`pcc override must be an integer between ${PCC_MIN} and ${PCC_MAX}, got ${value}`);
  }
}

export function createPccService(repo: PccRepository): PccService {
  return {
    async getOrCreateDailyPcc(teeConfigurationId, playedOnRaw) {
      const playedOn = getPlayedOnDate(playedOnRaw);
      return repo.getOrCreateDailyPcc(teeConfigurationId, playedOn);
    },

    async calculateOrOverride(teeConfigurationId, playedOnRaw, pccOverride, updatedBy) {
      const playedOn = getPlayedOnDate(playedOnRaw);

      let pcc: number;
      let source: PccSource;
      if (pccOverride === null) {
        const inputs = await repo.getRoundInputsForDay(teeConfigurationId, playedOn);
        pcc = derivePccFromRounds(inputs);
        source = "calculated";
      } else {
        assertValidOverride(pccOverride);
        pcc = pccOverride;
        source = "override";
      }

      return repo.upsertAndApply(teeConfigurationId, playedOn, pcc, source, source === "override" ? updatedBy : null);
    },
  };
}
