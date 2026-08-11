import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPccService,
  derivePccFromRounds,
  getPlayedOnDate,
  InvalidPccInputError,
} from "../src/application/pcc.service.ts";
import type { DailyPcc, PccRepository, PccSource, RoundDifferentialInput } from "../src/data/pcc.repository.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database.

test("derivePccFromRounds: zero rounds defaults to 0", () => {
  assert.equal(derivePccFromRounds([]), 0);
});

test("derivePccFromRounds: bucketing thresholds, verified against legacy's live services/pcc.ts formula", () => {
  const round = (adjustedGrossScore: number): RoundDifferentialInput => ({
    roundId: "r1",
    adjustedGrossScore,
    courseRating: 72,
    slopeRating: 113, // 113/113 = 1, so (adjustedGrossScore - 72) IS the raw differential
  });

  // average <= -1 -> -1
  assert.equal(derivePccFromRounds([round(71)]), -1); // diff = -1
  assert.equal(derivePccFromRounds([round(70)]), -1); // diff = -2, still <= -1

  // -1 < average < 0.5 -> 0
  assert.equal(derivePccFromRounds([round(72)]), 0); // diff = 0
  assert.equal(derivePccFromRounds([round(72.4)]), 0); // diff = 0.4

  // 0.5 <= average < 1.5 -> 1
  assert.equal(derivePccFromRounds([round(72.5)]), 1); // diff = 0.5
  assert.equal(derivePccFromRounds([round(73.4)]), 1); // diff = 1.4

  // 1.5 <= average < 2.5 -> 2
  assert.equal(derivePccFromRounds([round(73.5)]), 2); // diff = 1.5
  assert.equal(derivePccFromRounds([round(74.4)]), 2); // diff = 2.4

  // average >= 2.5 -> 3
  assert.equal(derivePccFromRounds([round(74.5)]), 3); // diff = 2.5
  assert.equal(derivePccFromRounds([round(90)]), 3); // diff way above
});

test("derivePccFromRounds: averages across multiple rounds at the same tee-configuration/day", () => {
  const rows: RoundDifferentialInput[] = [
    { roundId: "r1", adjustedGrossScore: 90, courseRating: 72, slopeRating: 113 }, // diff = 18
    { roundId: "r2", adjustedGrossScore: 72, courseRating: 72, slopeRating: 113 }, // diff = 0
  ];
  // average = 9 -> bucket 3
  assert.equal(derivePccFromRounds(rows), 3);
});

test("getPlayedOnDate: accepts a plain date and a full ISO date-time, normalises to YYYY-MM-DD", () => {
  assert.equal(getPlayedOnDate("2026-05-01"), "2026-05-01");
  assert.equal(getPlayedOnDate("2026-05-01T09:30:00.000Z"), "2026-05-01");
});

test("getPlayedOnDate: rejects an invalid date", () => {
  assert.throws(() => getPlayedOnDate("not-a-date"), InvalidPccInputError);
});

function fakeRepository(): PccRepository & {
  dailyPccRows: Map<string, DailyPcc>;
  roundInputs: RoundDifferentialInput[];
  applyCalls: Array<{ teeConfigurationId: string; playedOn: string; pcc: number; source: PccSource; updatedBy: string | null }>;
} {
  const dailyPccRows = new Map<string, DailyPcc>();
  const applyCalls: Array<{ teeConfigurationId: string; playedOn: string; pcc: number; source: PccSource; updatedBy: string | null }> = [];
  let roundInputs: RoundDifferentialInput[] = [];

  return {
    dailyPccRows,
    get roundInputs() {
      return roundInputs;
    },
    set roundInputs(value: RoundDifferentialInput[]) {
      roundInputs = value;
    },
    applyCalls,
    async getOrCreateDailyPcc(teeConfigurationId, playedOn) {
      const key = `${teeConfigurationId}:${playedOn}`;
      const existing = dailyPccRows.get(key);
      if (existing) return existing;
      const created: DailyPcc = {
        id: `daily-${key}`,
        teeConfigurationId,
        playedOn,
        pcc: 0,
        source: "calculated",
        updatedBy: null,
        updatedAt: new Date().toISOString(),
      };
      dailyPccRows.set(key, created);
      return created;
    },
    async getRoundInputsForDay() {
      return roundInputs;
    },
    async upsertAndApply(teeConfigurationId, playedOn, pcc, source, updatedBy) {
      applyCalls.push({ teeConfigurationId, playedOn, pcc, source, updatedBy });
      const dailyPcc: DailyPcc = {
        id: `daily-${teeConfigurationId}:${playedOn}`,
        teeConfigurationId,
        playedOn,
        pcc,
        source,
        updatedBy,
        updatedAt: new Date().toISOString(),
      };
      dailyPccRows.set(`${teeConfigurationId}:${playedOn}`, dailyPcc);
      return { dailyPcc, updatedRounds: roundInputs.length, affectedPlayerIds: [...new Set(roundInputs.map((r) => r.roundId))] };
    },
  };
}

test("calculateOrOverride: pccOverride=null calculates fresh from round inputs, source='calculated', updatedBy discarded", async () => {
  const repo = fakeRepository();
  repo.roundInputs = [{ roundId: "r1", adjustedGrossScore: 90, courseRating: 72, slopeRating: 113 }]; // diff=18 -> bucket 3
  const service = createPccService(repo);

  const result = await service.calculateOrOverride("tc-1", "2026-05-01", null, "admin-1");

  assert.equal(result.dailyPcc.pcc, 3);
  assert.equal(result.dailyPcc.source, "calculated");
  assert.equal(repo.applyCalls[0]!.updatedBy, null, "a calculated value is never attributed to an admin");
});

test("calculateOrOverride: a specific override value is used as-is, source='override', attributed to the acting admin", async () => {
  const repo = fakeRepository();
  const service = createPccService(repo);

  const result = await service.calculateOrOverride("tc-1", "2026-05-01", 2, "admin-1");

  assert.equal(result.dailyPcc.pcc, 2);
  assert.equal(result.dailyPcc.source, "override");
  assert.equal(repo.applyCalls[0]!.updatedBy, "admin-1");
});

test("calculateOrOverride: rejects an out-of-range override before it ever reaches the repository", async () => {
  const repo = fakeRepository();
  const service = createPccService(repo);

  await assert.rejects(() => service.calculateOrOverride("tc-1", "2026-05-01", 4, "admin-1"), InvalidPccInputError);
  await assert.rejects(() => service.calculateOrOverride("tc-1", "2026-05-01", -2, "admin-1"), InvalidPccInputError);
  assert.equal(repo.applyCalls.length, 0);
});

test("calculateOrOverride: rejects a non-integer override", async () => {
  const repo = fakeRepository();
  const service = createPccService(repo);
  await assert.rejects(() => service.calculateOrOverride("tc-1", "2026-05-01", 1.5, "admin-1"), InvalidPccInputError);
});

test("getOrCreateDailyPcc: normalises playedOn before delegating to the repository", async () => {
  const repo = fakeRepository();
  const service = createPccService(repo);

  const result = await service.getOrCreateDailyPcc("tc-1", "2026-05-01T09:00:00.000Z");
  assert.equal(result.playedOn, "2026-05-01");
  assert.equal(result.pcc, 0);
  assert.equal(result.source, "calculated");
});
