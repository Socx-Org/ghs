import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeNetDoubleBogeyAdjustedScore,
  computeScoreDifferential,
  computeStrokesReceived,
  createScoringService,
  HoleMetadataNotFoundError,
} from "../src/application/scoring.service.ts";
import type { CoursesRepository, TeeConfiguration } from "../src/data/courses.repository.ts";
import type { RoundsRepository } from "../src/data/rounds.repository.ts";
import type { PccService } from "../src/application/pcc.service.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database.

test("computeStrokesReceived: scratch handicap (0) receives nothing anywhere", () => {
  assert.equal(computeStrokesReceived(0, 1, 18), 0);
  assert.equal(computeStrokesReceived(0, 18, 18), 0);
});

test("computeStrokesReceived: positive handicap distributes strokes by stroke index, hardest holes first", () => {
  // playingHandicap 10 over 18 holes -> base 0, remainder 10 -> stroke
  // indexes 1..10 receive an extra stroke, 11..18 do not.
  assert.equal(computeStrokesReceived(10, 1, 18), 1);
  assert.equal(computeStrokesReceived(10, 10, 18), 1);
  assert.equal(computeStrokesReceived(10, 11, 18), 0);
  assert.equal(computeStrokesReceived(10, 18, 18), 0);
});

test("computeStrokesReceived: a handicap greater than hole count gives every hole a base stroke plus extras on the hardest", () => {
  // 22 over 18 holes -> base 1, remainder 4 -> stroke indexes 1..4 get a
  // second stroke.
  assert.equal(computeStrokesReceived(22, 1, 18), 2);
  assert.equal(computeStrokesReceived(22, 4, 18), 2);
  assert.equal(computeStrokesReceived(22, 5, 18), 1);
  assert.equal(computeStrokesReceived(22, 18, 18), 1);
});

test("computeStrokesReceived: a plus-handicap (negative) player gives strokes back, starting from the easiest holes", () => {
  // -5 over 18 holes -> base -0 (floor(5/18)=0), remainder 5 ->
  // easiestStrokeIndexThreshold = 18-5 = 13 -> stroke indexes 14..18
  // (the easiest holes, highest stroke index) give a stroke back.
  assert.equal(computeStrokesReceived(-5, 13, 18), 0);
  assert.equal(computeStrokesReceived(-5, 14, 18), -1);
  assert.equal(computeStrokesReceived(-5, 18, 18), -1);
});

test("computeStrokesReceived: a plus-handicap that divides evenly gives back the same amount on every hole", () => {
  // -18 over 18 holes -> base -1, remainder 0 -> every hole gives back 1,
  // no extra on top.
  assert.equal(computeStrokesReceived(-18, 1, 18), -1);
  assert.equal(computeStrokesReceived(-18, 18, 18), -1);
});

test("computeNetDoubleBogeyAdjustedScore: caps strokes at par+2+strokesReceived, never raises a lower score", () => {
  const hole = { par: 4, strokeIndex: 7 };
  // 0 handicap -> cap = 4+2+0 = 6
  assert.equal(computeNetDoubleBogeyAdjustedScore(9, 0, hole, 18), 6);
  assert.equal(computeNetDoubleBogeyAdjustedScore(3, 0, hole, 18), 3, "a genuinely low score is never raised to the cap");
  assert.equal(computeNetDoubleBogeyAdjustedScore(6, 0, hole, 18), 6, "exactly at the cap is unchanged");
});

test("computeNetDoubleBogeyAdjustedScore: the cap floor is never below 1 stroke even for an extreme plus handicap", () => {
  const hole = { par: 3, strokeIndex: 18 };
  // A very large plus handicap could in principle drive
  // par+2+strokesReceived below 1 -- Math.max(1, ...) guards it.
  assert.equal(computeNetDoubleBogeyAdjustedScore(1, -50, hole, 18) >= 1, true);
});

test("computeScoreDifferential: the real WHS formula, rounded to 3 decimals", () => {
  // (113/113) * (90 - 72 - 0) = 18
  assert.equal(computeScoreDifferential(90, 72, 113, 0), 18);
  // PCC subtracted before the multiplier: (113/113) * (90 - 72 - 2) = 16
  assert.equal(computeScoreDifferential(90, 72, 113, 2), 16);
  // A slope other than 113 actually scales the result.
  assert.equal(computeScoreDifferential(90, 72, 130, 0), Number(((113 / 130) * 18).toFixed(3)));
});

test("computeScoreDifferential: returns null defensively when rating data is missing, even though GHS's schema guarantees NOT NULL", () => {
  assert.equal(computeScoreDifferential(90, null, 113, 0), null);
  assert.equal(computeScoreDifferential(90, 72, null, 0), null);
  assert.equal(computeScoreDifferential(90, 72, 0, 0), null, "a zero slope must not divide by zero");
});

const FAKE_TEE_CONFIGURATION: TeeConfiguration = {
  id: "tee-1",
  name: "White",
  holeCount: 18,
  courseRating: 72.0,
  slopeRating: 113,
  holes: [{ id: "hole-1", holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
};

function fakeCoursesRepository(): CoursesRepository {
  return {
    async list() { return []; },
    async create() { throw new Error("not used"); },
    async get() { return null; },
    async getTeeConfiguration(id) {
      return id === FAKE_TEE_CONFIGURATION.id ? FAKE_TEE_CONFIGURATION : null;
    },
  };
}

test("computeHoleAdjustment: throws HoleMetadataNotFoundError for a hole number the tee configuration doesn't have", () => {
  const service = createScoringService(
    {} as RoundsRepository,
    fakeCoursesRepository(),
    {} as PccService,
  );
  assert.throws(
    () => service.computeHoleAdjustment({
      holeNumber: 2, // FAKE_TEE_CONFIGURATION only has hole 1
      strokes: 5,
      playingHandicap: 0,
      holes: FAKE_TEE_CONFIGURATION.holes,
      holeCount: 18,
    }),
    HoleMetadataNotFoundError,
  );
});

test("computeHoleAdjustment: rounds a fractional playing handicap before allocating strokes", () => {
  const service = createScoringService(
    {} as RoundsRepository,
    fakeCoursesRepository(),
    {} as PccService,
  );
  // 10.6 rounds to 11 -> base 0, remainder 11, stroke index 7 <= 11 -> 1 received.
  // cap = 4+2+1 = 7.
  const result = service.computeHoleAdjustment({
    holeNumber: 1,
    strokes: 9,
    playingHandicap: 10.6,
    holes: FAKE_TEE_CONFIGURATION.holes,
    holeCount: 18,
  });
  assert.equal(result, 7);
});
