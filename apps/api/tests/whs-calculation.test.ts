import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyWhsCaps,
  buildEffectiveDifferentials,
  calculateHandicapIndex,
  MINIMUM_ELIGIBLE_HOLES,
  truncateToDecimals,
  WHS_COUNT_TABLE,
} from "../src/application/whs-calculation.ts";
import type { RoundDifferentialInput } from "../src/application/whs-calculation.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database.

const BASE_DATE = new Date("2026-06-01T09:00:00.000Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(BASE_DATE - n * DAY_MS).toISOString();
}

function round(id: string, daysAgoCount: number, scoreDifferential: number, is9Hole = false): RoundDifferentialInput {
  return { roundId: id, playedAt: daysAgo(daysAgoCount), scoreDifferential, is9Hole };
}

test("truncateToDecimals truncates toward zero, never rounds", () => {
  assert.equal(truncateToDecimals(7.68, 1), 7.6);
  assert.equal(truncateToDecimals(7.65, 1), 7.6, "a value that would round up must not be rounded");
  assert.equal(truncateToDecimals(-7.65, 1), -7.6, "truncation toward zero, not toward negative infinity");
  assert.equal(truncateToDecimals(4.9999, 1), 4.9);
});

// --- Rule 5.2a table, verified: every row individually ---
// https://www.randa.org/en/roh/the-rules-of-handicapping/rule-5
// https://www.mapperleygolfclub.org/calculation-of-handicap-index/

const TABLE_CASES: Array<{ scores: number; expectedCount: number; expectedAdjustment: number }> = [
  { scores: 3, expectedCount: 1, expectedAdjustment: -2.0 },
  { scores: 4, expectedCount: 1, expectedAdjustment: -1.0 },
  { scores: 5, expectedCount: 1, expectedAdjustment: 0 },
  { scores: 6, expectedCount: 2, expectedAdjustment: -1.0 },
  { scores: 7, expectedCount: 2, expectedAdjustment: 0 },
  { scores: 8, expectedCount: 2, expectedAdjustment: 0 },
  { scores: 9, expectedCount: 3, expectedAdjustment: 0 },
  { scores: 11, expectedCount: 3, expectedAdjustment: 0 },
  { scores: 12, expectedCount: 4, expectedAdjustment: 0 },
  { scores: 14, expectedCount: 4, expectedAdjustment: 0 },
  { scores: 15, expectedCount: 5, expectedAdjustment: 0 },
  { scores: 16, expectedCount: 5, expectedAdjustment: 0 },
  { scores: 17, expectedCount: 6, expectedAdjustment: 0 },
  { scores: 18, expectedCount: 6, expectedAdjustment: 0 },
  { scores: 19, expectedCount: 7, expectedAdjustment: 0 },
  { scores: 20, expectedCount: 8, expectedAdjustment: 0 },
];

for (const { scores, expectedCount, expectedAdjustment } of TABLE_CASES) {
  test(`Rule 5.2a: ${scores} scores available -> lowest ${expectedCount} used, adjustment ${expectedAdjustment}`, () => {
    // Differentials 1..N so "lowest count" is unambiguous and checkable.
    const rounds = Array.from({ length: scores }, (_, i) => round(`r${i}`, scores - i, i + 1));
    const outcome = calculateHandicapIndex(rounds);

    assert.equal(outcome.status, "eligible");
    if (outcome.status !== "eligible") return;
    assert.equal(outcome.selection.countUsed, expectedCount);
    assert.equal(outcome.selection.adjustment, expectedAdjustment);
    assert.equal(outcome.selection.selected.length, expectedCount);
    assert.deepEqual(outcome.selection.selected.map((d) => d.value), Array.from({ length: expectedCount }, (_, i) => i + 1));
  });
}

test("WHS_COUNT_TABLE has exactly 11 rows, one per verified case (3, 4, 5, 6, 7-8, 9-11, 12-14, 15-16, 17-18, 19, 20)", () => {
  assert.equal(WHS_COUNT_TABLE.length, 11);
});

test("more than 20 scores caps at the 20-row behaviour (WHS Rule 5.1: most recent 20 only)", () => {
  const rounds = Array.from({ length: 25 }, (_, i) => round(`r${i}`, 25 - i, i + 1));
  const outcome = calculateHandicapIndex(rounds);
  assert.equal(outcome.status, "eligible");
  if (outcome.status !== "eligible") return;
  assert.equal(outcome.selection.roundsConsidered, 20, "only the most recent 20 are ever considered");
  assert.equal(outcome.selection.countUsed, 8);
});

// --- End-to-end formula spot checks, hand-computed ---

test("end-to-end: 3 rounds, average+adjustment, 0.96 multiplier, truncation not rounding", () => {
  const rounds = [round("r1", 3, 10.0), round("r2", 2, 12.0), round("r3", 1, 14.0)];
  const outcome = calculateHandicapIndex(rounds);
  assert.equal(outcome.status, "eligible");
  if (outcome.status !== "eligible") return;

  // lowest 1 = 10.0, adjustment -2.0 -> (10.0 - 2.0) * 0.96 = 7.68 -> truncated 7.6
  assert.equal(outcome.selection.averageDifferential, 10.0);
  assert.equal(outcome.selection.rawHandicapIndex, 7.6);
  assert.equal(outcome.selection.multiplier, 0.96);
});

test("end-to-end: 6 rounds, lowest 2 averaged, adjustment applied before the multiplier", () => {
  const rounds = [5.0, 6.0, 7.0, 8.0, 9.0, 10.0].map((d, i) => round(`r${i}`, 6 - i, d));
  const outcome = calculateHandicapIndex(rounds);
  assert.equal(outcome.status, "eligible");
  if (outcome.status !== "eligible") return;

  // lowest 2 = [5.0, 6.0], average 5.5, adjustment -1.0 -> 4.5 * 0.96 = 4.32 -> truncated 4.3
  assert.equal(outcome.selection.averageDifferential, 5.5);
  assert.equal(outcome.selection.rawHandicapIndex, 4.3);
});

// --- Eligibility boundary ---
// "53 vs 54 holes" isn't directly reachable in this model -- every
// effective differential is always a complete 18-hole-equivalent (a real
// 18-hole round, or a completed pair of 9s); WHS never grants partial
// credit for an incomplete round. The genuinely meaningful boundary is 2
// vs 3 effective differentials (36 vs 54 holes).

test("eligibility: exactly 2 effective differentials (36 holes) is insufficient", () => {
  const rounds = [round("r1", 2, 10.0), round("r2", 1, 12.0)];
  const outcome = calculateHandicapIndex(rounds);
  assert.equal(outcome.status, "insufficient_holes");
  if (outcome.status !== "insufficient_holes") return;
  assert.equal(outcome.totalEligibleHoles, 36);
  assert.equal(outcome.totalEligibleHoles < MINIMUM_ELIGIBLE_HOLES, true);
});

test("eligibility: exactly 3 effective differentials (54 holes) is the minimum eligible", () => {
  const rounds = [round("r1", 3, 10.0), round("r2", 2, 12.0), round("r3", 1, 14.0)];
  const outcome = calculateHandicapIndex(rounds);
  assert.equal(outcome.status, "eligible");
  if (outcome.status !== "eligible") return;
  assert.equal(outcome.selection.roundsConsidered * 18, MINIMUM_ELIGIBLE_HOLES);
});

// --- 9-hole pairing and ageing (Rule 5.5) ---

test("9-hole: two 9-hole rounds on the same day pair into one effective 18-hole-equivalent differential", () => {
  const rounds: RoundDifferentialInput[] = [
    round("nine-a", 2, 8.0, true),
    round("nine-b", 2, 7.0, true),
  ];
  const { effectiveDifferentials, discardedNineHoleRoundId } = buildEffectiveDifferentials(rounds);
  assert.equal(effectiveDifferentials.length, 1);
  assert.equal(effectiveDifferentials[0]!.source, "paired_9_hole");
  assert.equal(effectiveDifferentials[0]!.value, 15.0);
  assert.deepEqual(effectiveDifferentials[0]!.roundIds.sort(), ["nine-a", "nine-b"]);
  assert.equal(discardedNineHoleRoundId, null);
});

test("9-hole: two 9-hole rounds on different days still pair, matched to the next 9-hole round encountered chronologically", () => {
  const rounds: RoundDifferentialInput[] = [
    round("full-between", 5, 20.0, false), // an 18-hole round in between, chronologically
    round("nine-recent", 10, 8.0, true),
    round("nine-older", 20, 7.0, true),
  ];
  const { effectiveDifferentials } = buildEffectiveDifferentials(rounds);
  const paired = effectiveDifferentials.find((d) => d.source === "paired_9_hole");
  assert.ok(paired, "the two 9-hole rounds paired despite the full round played between them");
  assert.equal(paired!.value, 15.0);
  assert.deepEqual(paired!.roundIds.sort(), ["nine-older", "nine-recent"]);
});

test("9-hole: an unpaired round is retained (not discarded) when fewer than 20 full rounds exist on record", () => {
  const rounds: RoundDifferentialInput[] = [
    round("full-1", 3, 10.0, false),
    round("full-2", 2, 11.0, false),
    round("lone-nine", 1, 8.0, true),
  ];
  const { effectiveDifferentials, discardedNineHoleRoundId } = buildEffectiveDifferentials(rounds);
  assert.equal(discardedNineHoleRoundId, null, "still waiting for a partner, not yet aged out");
  assert.equal(effectiveDifferentials.length, 2, "the lone 9-hole round contributes nothing while pending -- neither counted nor discarded");
  assert.equal(effectiveDifferentials.some((d) => d.roundIds.includes("lone-nine")), false);
});

test("9-hole: an unpaired round still within the 20th-oldest-18-hole window is retained", () => {
  // 20 full rounds, all more recent than the lone 9-hole round, but the
  // lone round is not older than the 20th (oldest) of them.
  const fullRounds = Array.from({ length: 20 }, (_, i) => round(`full-${i}`, i + 1, 10.0 + i, false)); // days 1..20
  const lone = round("lone-nine", 20, 8.0, true); // exactly as old as the 20th full round -- not older
  const { discardedNineHoleRoundId } = buildEffectiveDifferentials([...fullRounds, lone]);
  assert.equal(discardedNineHoleRoundId, null, "not strictly older than the cutoff -- still retained");
});

test("9-hole: a paired 9-hole set counts toward the 20-score total too, not just real 18-hole rounds (PR #29 review fix)", () => {
  // 19 real 18-hole rounds + one already-paired 9-hole set = 20 resolved
  // 18-hole-equivalent scores. A version of this function that only
  // counted real 18-hole rounds toward the cutoff (19 < 20) would wrongly
  // conclude there were only 19 -- never reaching the threshold at all.
  const fullRounds = Array.from({ length: 19 }, (_, i) => round(`full-${i}`, i + 1, 10.0 + i, false)); // days 1..19
  const pairA = round("pair-a", 21, 8.0, true);
  const pairB = round("pair-b", 20, 7.0, true);

  const { effectiveDifferentials, discardedNineHoleRoundId } = buildEffectiveDifferentials([...fullRounds, pairA, pairB]);

  assert.equal(effectiveDifferentials.length, 20, "19 full rounds + 1 paired-9 set = 20 resolved scores");
  assert.equal(discardedNineHoleRoundId, null, "nothing left pending here -- both 9-hole rounds paired with each other");
});

test("9-hole: with an odd number of 9-hole rounds, the two oldest pair together and the most recent one is left pending -- not the reverse (PR #29 review fix)", () => {
  // Chronological pairing: a live system pairs each new 9-hole round
  // with whichever round has been waiting longest. Pairing newest-first
  // would incorrectly pair the two most recent rounds and strand the
  // oldest one as "pending" -- backwards from how ageing is meant to work.
  const oldest = round("oldest-nine", 30, 9.0, true);
  const middle = round("middle-nine", 20, 8.0, true);
  const mostRecent = round("recent-nine", 10, 7.0, true);

  const { effectiveDifferentials, discardedNineHoleRoundId } = buildEffectiveDifferentials([oldest, middle, mostRecent]);

  assert.equal(effectiveDifferentials.length, 1);
  assert.equal(effectiveDifferentials[0]!.source, "paired_9_hole");
  assert.deepEqual(effectiveDifferentials[0]!.roundIds.sort(), ["middle-nine", "oldest-nine"], "the two OLDEST rounds pair together");
  assert.equal(effectiveDifferentials.some((d) => d.roundIds.includes("recent-nine")), false, "the most recent round is not part of any pair");
  assert.equal(discardedNineHoleRoundId, null, "too few resolved scores on record yet for any cutoff to apply -- the most recent round is simply still pending");
});

test("9-hole: paired-differential sum is rounded, not truncated, to 3 decimals -- consistent with computeScoreDifferential's own precision policy (PR #29 review fix)", () => {
  const rounds: RoundDifferentialInput[] = [
    round("nine-a", 2, 8.1236, true),
    round("nine-b", 2, 7.0001, true),
  ];
  const { effectiveDifferentials } = buildEffectiveDifferentials(rounds);
  // 8.1236 + 7.0001 = 15.1237 -> rounds to 15.124; truncation would give
  // 15.123 instead -- verified numerically (floating-point sums don't
  // always land where hand arithmetic suggests) before relying on it.
  assert.equal(effectiveDifferentials[0]!.value, 15.124);
});

test("9-hole: an unpaired round older than the 20th-oldest 18-hole score is discarded", () => {
  const fullRounds = Array.from({ length: 20 }, (_, i) => round(`full-${i}`, i + 1, 10.0 + i, false)); // days 1..20
  const agedOut = round("aged-nine", 21, 8.0, true); // one day older than the 20th (oldest) full round
  const { discardedNineHoleRoundId, effectiveDifferentials } = buildEffectiveDifferentials([...fullRounds, agedOut]);
  assert.equal(discardedNineHoleRoundId, "aged-nine");
  assert.equal(effectiveDifferentials.some((d) => d.roundIds.includes("aged-nine")), false);
});

// --- Soft/hard caps (Rule 5.9) ---

test("caps: no cap triggers when the raw index is at or below the soft cap threshold", () => {
  const result = applyWhsCaps(13.0, 10.0); // soft threshold = 13.0
  assert.equal(result.appliedHandicapIndex, 13.0);
  assert.equal(result.softCapTriggered, false);
  assert.equal(result.hardCapTriggered, false);
});

test("caps: soft cap halves the excess once the raw index exceeds low+3", () => {
  const result = applyWhsCaps(15.0, 10.0); // soft threshold 13.0, excess 2.0 -> 13.0 + 1.0 = 14.0
  assert.equal(result.softCapTriggered, true);
  assert.equal(result.hardCapTriggered, false);
  assert.equal(result.appliedHandicapIndex, 14.0);
});

test("caps: hard cap is an absolute ceiling at low+5, applied after the soft cap reduction", () => {
  const result = applyWhsCaps(25.0, 10.0); // soft threshold 13.0, excess 12.0 -> soft-capped to 19.0, still above hard cap 15.0
  assert.equal(result.softCapTriggered, true);
  assert.equal(result.hardCapTriggered, true);
  assert.equal(result.appliedHandicapIndex, 15.0);
});

test("caps: landing exactly at the hard cap threshold after the soft cap reduction does not additionally trigger the hard cap", () => {
  // soft threshold 13.0, raw 17.0 -> excess 4.0 -> soft-capped to
  // 13.0 + 4.0*0.5 = 15.0, which is exactly the hard threshold (10+5) --
  // not strictly above it, so hardCapTriggered must stay false.
  const result = applyWhsCaps(17.0, 10.0);
  assert.equal(result.appliedHandicapIndex, 15.0);
  assert.equal(result.softCapTriggered, true);
  assert.equal(result.hardCapTriggered, false, "exactly at the threshold, not strictly above it");
});

test("caps: with no prior Low Handicap Index (a player's first-ever calculation), neither cap can trigger", () => {
  const result = applyWhsCaps(22.4, null);
  assert.equal(result.appliedHandicapIndex, 22.4);
  assert.equal(result.softCapTriggered, false);
  assert.equal(result.hardCapTriggered, false);
  assert.equal(result.lowHandicapIndexUsed, 22.4);
});
