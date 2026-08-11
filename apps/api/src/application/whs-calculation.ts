// The WHS Handicap Calculation Engine -- pure calculation functions, no
// database access (ADR-060). Re-verified against authoritative WHS
// sources during Phase 2 planning, not reproduced from legacy or
// recollection:
//   - R&A Rule 5: https://www.randa.org/en/roh/the-rules-of-handicapping/rule-5
//   - USGA WHS FAQs: https://www.usga.org/content/usga/home-page/handicapping/world-handicap-system/world-handicap-system-usga-golf-faqs.html
//   - Independent third reproduction of the Rule 5.2a table: https://www.mapperleygolfclub.org/calculation-of-handicap-index/
//
// Legacy GHS was found wrong on all three previously-disputed points
// (Rule 5.2a's adjustment column and 5/6-score boundary, Rule 5.5's
// 9-hole ageing, and the Low Handicap Index rolling window) -- none of
// those three are preserved. Everything else here (0.96 multiplier,
// truncation not rounding, soft/hard cap mechanics, the 54-hole
// eligibility floor) was independently verified as genuinely correct and
// is preserved.
//
// Low Handicap Index itself is NOT recomputed here -- that's a rolling
// 365-day window over handicap_history, already implemented and tested
// at the data layer in handicap-history.repository.ts (ghs#21).
// Reimplementing that window a second time here, in pure code, would be
// exactly the kind of duplicated logic this programme has repeatedly
// avoided elsewhere (recalculation orchestration, the handicap_history
// write path). applyWhsCaps below takes the current Low Handicap Index
// as a plain input -- the caller (ghs#24's orchestrator) reads it from
// ghs#21's HandicapHistoryService before calling in here, and writes the
// result back through the same shared path afterwards.

export const MINIMUM_ELIGIBLE_HOLES = 54;
const MINIMUM_EFFECTIVE_DIFFERENTIALS = 3;
const MAX_EFFECTIVE_DIFFERENTIALS = 20; // WHS Rule 5.1: only the most recent 20 scores are ever considered.
const WHS_MULTIPLIER = 0.96;
const SOFT_CAP_THRESHOLD_STROKES = 3;
const SOFT_CAP_REDUCTION = 0.5;
const HARD_CAP_THRESHOLD_STROKES = 5;

interface CountTableEntry {
  min: number;
  max: number;
  count: number;
  adjustment: number;
}

// Rule 5.2a, verified (see file header for sources). Every row below was
// checked individually, including the corrected 5/6-score boundary
// (legacy used lowest-1 for both; the real rule splits 5 -> lowest-1 and
// 6 -> lowest-2) and the adjustment column legacy has no equivalent of
// at all.
export const WHS_COUNT_TABLE: readonly CountTableEntry[] = [
  { min: 3, max: 3, count: 1, adjustment: -2.0 },
  { min: 4, max: 4, count: 1, adjustment: -1.0 },
  { min: 5, max: 5, count: 1, adjustment: 0 },
  { min: 6, max: 6, count: 2, adjustment: -1.0 },
  { min: 7, max: 8, count: 2, adjustment: 0 },
  { min: 9, max: 11, count: 3, adjustment: 0 },
  { min: 12, max: 14, count: 4, adjustment: 0 },
  { min: 15, max: 16, count: 5, adjustment: 0 },
  { min: 17, max: 18, count: 6, adjustment: 0 },
  { min: 19, max: 19, count: 7, adjustment: 0 },
  { min: 20, max: 20, count: 8, adjustment: 0 },
];

function lookupCountTable(effectiveDifferentialCount: number): CountTableEntry | null {
  const capped = Math.min(effectiveDifferentialCount, MAX_EFFECTIVE_DIFFERENTIALS);
  if (capped < MINIMUM_EFFECTIVE_DIFFERENTIALS) return null;
  return WHS_COUNT_TABLE.find((row) => capped >= row.min && capped <= row.max) ?? null;
}

// Truncates (never rounds) toward zero -- the real WHS convention,
// confirmed against legacy's own (correctly-preserved) truncation
// behaviour. Number.prototype.toFixed rounds and is deliberately not
// used here.
export function truncateToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.trunc(value * factor) / factor;
}

export interface RoundDifferentialInput {
  roundId: string;
  playedAt: string; // ISO
  scoreDifferential: number;
  is9Hole: boolean;
}

export type EffectiveDifferentialSource = "full_round" | "paired_9_hole";

export interface EffectiveDifferential {
  value: number;
  source: EffectiveDifferentialSource;
  roundIds: string[];
  playedAt: string;
}

export interface BuildEffectiveDifferentialsResult {
  // Already capped to the most recent 20 (WHS Rule 5.1).
  effectiveDifferentials: EffectiveDifferential[];
  // The roundId of an unpaired 9-hole round that aged out this
  // calculation, if any -- null when nothing was discarded (including
  // when a 9-hole round is still legitimately pending/retained, waiting
  // for a partner).
  discardedNineHoleRoundId: string | null;
}

// Rule 5.5, verified: an unpaired 9-hole score is retained, waiting for
// a pairing partner, until it becomes older than the 20th-oldest 18-hole
// score in the record, then discarded. Legacy drops an unpaired 9
// immediately with no waiting period -- not preserved.
//
// Pairing itself (two 9-hole rounds summed into one 18-hole-equivalent
// differential, matched to the next 9-hole round encountered
// chronologically, not necessarily date-adjacent) was not a disputed
// point during discovery and is preserved from legacy's real algorithm.
//
// The "20th-oldest 18-hole score" cutoff is a genuine interpretation
// call, not independently re-verified beyond the rule text already
// fetched (see file header) -- implemented here as: among the player's
// resolved 18-hole-equivalent scores (real full 18-hole rounds AND
// already-paired 9-hole sets -- a paired 9-hole score is an 18-hole-
// equivalent score for every other purpose, so it counts here too; a
// still-pending, unpaired 9 obviously cannot, since it isn't one yet),
// if there are at least 20, the cutoff is the played_at of the 20th most
// recent one; anything older than that is outside the range WHS ever
// considers anyway (Rule 5.1's own most-recent-20 window), so a pending
// 9 older than it is discarded. With fewer than 20 resolved scores on
// record, no cutoff applies yet and the pending 9 is simply retained.
// (Caught in review: an earlier version of this function derived the
// cutoff from real 18-hole rounds only, which meant 19 full rounds plus
// one already-paired 9-hole set -- 20 resolved scores in total -- would
// wrongly still report no cutoff at all.)
export function buildEffectiveDifferentials(rounds: RoundDifferentialInput[]): BuildEffectiveDifferentialsResult {
  const sortedDesc = [...rounds].sort((a, b) => (a.playedAt < b.playedAt ? 1 : a.playedAt > b.playedAt ? -1 : 0));

  const resolved: EffectiveDifferential[] = [];
  let pending: RoundDifferentialInput | null = null;

  for (const round of sortedDesc) {
    if (!round.is9Hole) {
      resolved.push({ value: round.scoreDifferential, source: "full_round", roundIds: [round.roundId], playedAt: round.playedAt });
      continue;
    }

    if (pending === null) {
      pending = round;
      continue;
    }

    // `pending` was encountered first while walking most-recent-first,
    // so it's the more recent of the pair. Rounded (not truncated) to 3
    // decimals -- consistent with computeScoreDifferential's own
    // rounding for an individual round's differential (scoring.
    // service.ts); truncation is specifically a final-index-level
    // requirement (Rule 5.2a), not a general precision policy for every
    // intermediate sum (caught in review).
    resolved.push({
      value: Number((pending.scoreDifferential + round.scoreDifferential).toFixed(3)),
      source: "paired_9_hole",
      roundIds: [pending.roundId, round.roundId],
      playedAt: pending.playedAt,
    });
    pending = null;
  }

  const resolvedDesc = [...resolved].sort((a, b) => (a.playedAt < b.playedAt ? 1 : a.playedAt > b.playedAt ? -1 : 0));
  const cutoffDate = resolvedDesc.length >= MAX_EFFECTIVE_DIFFERENTIALS
    ? resolvedDesc[MAX_EFFECTIVE_DIFFERENTIALS - 1]!.playedAt
    : null;

  let discardedNineHoleRoundId: string | null = null;
  if (pending !== null && cutoffDate !== null && pending.playedAt < cutoffDate) {
    discardedNineHoleRoundId = pending.roundId;
  }

  return { effectiveDifferentials: resolvedDesc.slice(0, MAX_EFFECTIVE_DIFFERENTIALS), discardedNineHoleRoundId };
}

export interface HandicapSelectionResult {
  roundsConsidered: number;
  effectiveDifferentials: EffectiveDifferential[];
  countUsed: number;
  adjustment: number;
  selected: EffectiveDifferential[];
  averageDifferential: number; // average of selected, truncated to 3 decimals -- before the adjustment is added
  multiplier: typeof WHS_MULTIPLIER;
  rawHandicapIndex: number; // (averageDifferential + adjustment) * multiplier, truncated to 1 decimal
}

export type HandicapCalculationOutcome =
  | { status: "insufficient_holes"; totalEligibleHoles: number }
  | { status: "insufficient_rounds"; roundsConsidered: number }
  | { status: "eligible"; selection: HandicapSelectionResult };

// Selects the lowest countUsed effective differentials per the verified
// Rule 5.2a table, averages them, applies the low-count adjustment, then
// the 0.96 multiplier -- truncated (not rounded) at each stage that
// legacy also truncated at, confirmed as genuinely correct rather than a
// legacy technical habit.
export function calculateHandicapIndex(rounds: RoundDifferentialInput[]): HandicapCalculationOutcome {
  const { effectiveDifferentials } = buildEffectiveDifferentials(rounds);
  const totalEligibleHoles = effectiveDifferentials.length * 18;

  if (totalEligibleHoles < MINIMUM_ELIGIBLE_HOLES) {
    return { status: "insufficient_holes", totalEligibleHoles };
  }

  const entry = lookupCountTable(effectiveDifferentials.length);
  if (!entry) {
    return { status: "insufficient_rounds", roundsConsidered: effectiveDifferentials.length };
  }

  const selected = [...effectiveDifferentials].sort((a, b) => a.value - b.value).slice(0, entry.count);
  const rawAverage = selected.reduce((sum, d) => sum + d.value, 0) / selected.length;
  const averageDifferential = truncateToDecimals(rawAverage, 3);
  const rawHandicapIndex = truncateToDecimals((averageDifferential + entry.adjustment) * WHS_MULTIPLIER, 1);

  return {
    status: "eligible",
    selection: {
      roundsConsidered: effectiveDifferentials.length,
      effectiveDifferentials,
      countUsed: entry.count,
      adjustment: entry.adjustment,
      selected,
      averageDifferential,
      multiplier: WHS_MULTIPLIER,
      rawHandicapIndex,
    },
  };
}

export interface CapApplicationResult {
  rawHandicapIndex: number;
  appliedHandicapIndex: number;
  softCapTriggered: boolean;
  hardCapTriggered: boolean;
  softCapThreshold: number;
  hardCapThreshold: number;
  // The Low Handicap Index actually used -- either the caller-supplied
  // value, or, on a player's very first-ever calculation (no Low HI
  // established yet), the raw index itself (so neither cap can trigger
  // on a first calculation, matching the real rule's intent -- there's
  // nothing to compare against yet).
  lowHandicapIndexUsed: number;
}

// Rule 5.9, verified and preserved unchanged from legacy: soft cap
// (+3, 50% of the excess above that threshold) then hard cap (+5,
// absolute ceiling), both measured against the player's Low Handicap
// Index. lowHandicapIndex is a plain input -- see the file header for
// why the rolling-window computation itself lives in ghs#21, not here.
export function applyWhsCaps(rawHandicapIndex: number, lowHandicapIndex: number | null): CapApplicationResult {
  const low = lowHandicapIndex ?? rawHandicapIndex;
  const softCapThreshold = low + SOFT_CAP_THRESHOLD_STROKES;
  const hardCapThreshold = low + HARD_CAP_THRESHOLD_STROKES;

  let applied = rawHandicapIndex;
  let softCapTriggered = false;
  let hardCapTriggered = false;

  if (rawHandicapIndex > softCapThreshold) {
    const excess = rawHandicapIndex - softCapThreshold;
    applied = truncateToDecimals(softCapThreshold + excess * SOFT_CAP_REDUCTION, 1);
    softCapTriggered = true;
  }

  if (applied > hardCapThreshold) {
    applied = hardCapThreshold;
    hardCapTriggered = true;
  }

  return {
    rawHandicapIndex,
    appliedHandicapIndex: applied,
    softCapTriggered,
    hardCapTriggered,
    softCapThreshold,
    hardCapThreshold,
    lowHandicapIndexUsed: low,
  };
}
