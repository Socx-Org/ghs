import type { CoursesRepository, Hole } from "../data/courses.repository.ts";
import type { Round, RoundsRepository } from "../data/rounds.repository.ts";
import type { PccService } from "./pcc.service.ts";

// WHS scoring domain logic (ADR-060) -- net double bogey adjustment
// (Rule 3.1) and score differential. Kept separate from round management
// (rounds.service.ts) and PCC (pcc.service.ts) per the domain-boundary
// decomposition agreed during Phase 2 discovery: legacy's module
// structure (everything inline in routes/rounds.ts) does not dictate
// GHS's boundaries.

export class HoleMetadataNotFoundError extends Error {}

// A plus-handicap player (negative playingHandicap) gives strokes back
// rather than receiving them, starting from the easiest holes (highest
// stroke index) -- confirmed against legacy's live rounds.ts, which
// implements the same reverse allocation.
export function computeStrokesReceived(playingHandicap: number, holeStrokeIndex: number, holeCount: number): number {
  if (holeCount <= 0) return 0;

  if (playingHandicap >= 0) {
    const base = Math.floor(playingHandicap / holeCount);
    const remainder = playingHandicap % holeCount;
    return base + (holeStrokeIndex <= remainder ? 1 : 0);
  }

  const abs = Math.abs(playingHandicap);
  const base = -Math.floor(abs / holeCount);
  const remainder = abs % holeCount;
  if (remainder === 0) return base;

  const easiestStrokeIndexThreshold = holeCount - remainder;
  return base + (holeStrokeIndex > easiestStrokeIndexThreshold ? -1 : 0);
}

// WHS Rule 3.1: a hole score for handicap purposes is capped at net
// double bogey -- par + 2 strokes, plus any strokes received on that
// hole.
export function computeNetDoubleBogeyAdjustedScore(
  strokes: number,
  playingHandicap: number,
  hole: { par: number; strokeIndex: number },
  holeCount: number,
): number {
  const strokesReceived = computeStrokesReceived(playingHandicap, hole.strokeIndex, holeCount);
  const netDoubleBogeyCap = Math.max(1, hole.par + 2 + strokesReceived);
  return Math.min(strokes, netDoubleBogeyCap);
}

// Score Differential = (113 / Slope Rating) x (Adjusted Gross Score -
// Course Rating - PCC), rounded to 3 decimals -- the real, authoritative
// WHS formula, confirmed against legacy's live bulk-recompute SQL
// (services/pcc.ts) during Phase 2 discovery. GHS's tee_configurations
// schema requires course_rating/slope_rating NOT NULL (ghs#7), so the
// null-returning branch below is unreachable in practice, but the pure
// function stays defensive rather than assuming its caller's schema
// guarantees.
export function computeScoreDifferential(
  adjustedGrossScore: number,
  courseRating: number | null,
  slopeRating: number | null,
  pcc: number,
): number | null {
  if (courseRating === null || slopeRating === null || slopeRating <= 0) {
    return null;
  }
  const differential = (113 / slopeRating) * (adjustedGrossScore - courseRating - pcc);
  return Number(differential.toFixed(3));
}

function findHole(holes: Hole[], holeNumber: number): Hole {
  const hole = holes.find((h) => h.holeNumber === holeNumber);
  if (!hole) {
    throw new HoleMetadataNotFoundError(`no hole metadata for hole ${holeNumber} on this tee configuration`);
  }
  return hole;
}

export interface ScoringService {
  // Given a hole's raw strokes and the round/tee-configuration context,
  // returns the net-double-bogey-adjusted value to store for that hole.
  // Pure with respect to this service's own state -- callers (rounds.
  // service.ts) own fetching the round and tee-configuration context;
  // this service has no direct database access of its own for this
  // method.
  computeHoleAdjustment(input: {
    holeNumber: number;
    strokes: number;
    playingHandicap: number;
    holes: Hole[];
    holeCount: number;
  }): number;

  // Recomputes a round's aggregate WHS fields (gross/adjusted gross
  // score, totals, score differential) from its current hole scores and
  // persists them via the existing RoundsRepository.updateScores()
  // partial-update method (ghs#9) -- not a new write path. Each hole
  // score's own net_double_bogey_adjusted is assumed already correct
  // (computed at hole-insertion time, not here) -- this only sums what's
  // already stored.
  recomputeRoundAggregates(roundId: string): Promise<Round>;
}

export function createScoringService(rounds: RoundsRepository, courses: CoursesRepository, pcc: PccService): ScoringService {
  return {
    computeHoleAdjustment({ holeNumber, strokes, playingHandicap, holes, holeCount }) {
      const hole = findHole(holes, holeNumber);
      return computeNetDoubleBogeyAdjustedScore(strokes, Math.round(playingHandicap), hole, holeCount);
    },

    async recomputeRoundAggregates(roundId) {
      const round = await rounds.get(roundId);
      if (!round) throw new Error("round not found");

      const teeConfiguration = await courses.getTeeConfiguration(round.teeConfigurationId);
      if (!teeConfiguration) throw new Error("tee configuration not found");

      const grossScore = round.holeScores.reduce((sum, h) => sum + h.strokes, 0);
      const adjustedGrossScore = round.holeScores.reduce((sum, h) => sum + h.netDoubleBogeyAdjusted, 0);
      const totalPutts = round.holeScores.reduce((sum, h) => sum + (h.putts ?? 0), 0);
      const totalGir = round.holeScores.reduce((sum, h) => sum + (h.gir ? 1 : 0), 0);
      const totalFairwaysHit = round.holeScores.reduce((sum, h) => sum + (h.fairwayResult === "hit" ? 1 : 0), 0);
      const totalPenalties = round.holeScores.reduce((sum, h) => sum + h.penalties, 0);

      const dailyPcc = await pcc.getOrCreateDailyPcc(round.teeConfigurationId, round.playedAt);
      const scoreDifferential = computeScoreDifferential(
        adjustedGrossScore,
        teeConfiguration.courseRating,
        teeConfiguration.slopeRating,
        dailyPcc.pcc,
      );

      return rounds.updateScores(roundId, {
        grossScore,
        adjustedGrossScore,
        totalPutts,
        totalGir,
        totalFairwaysHit,
        totalPenalties,
        ...(scoreDifferential !== null ? { scoreDifferential } : {}),
      });
    },
  };
}
