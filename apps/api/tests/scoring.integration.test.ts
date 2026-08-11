import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createRoundsService } from "../src/application/rounds.service.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE clubs, users, system_settings RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

async function createTeeConfiguration(): Promise<{ teeConfigurationId: string; holeNumbers: number[] }> {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Scoring Test Course",
    country: "ES",
    teeConfigurations: [
      {
        name: "White",
        holeCount: 18,
        courseRating: 72.0,
        slopeRating: 113, // 113/113 = 1, differential == (ags - cr - pcc)
        holes: Array.from({ length: 18 }, (_, i) => ({
          holeNumber: i + 1,
          distanceYards: 380,
          par: 4,
          strokeIndex: i + 1,
        })),
      },
    ],
  });
  return {
    teeConfigurationId: course.teeConfigurations[0]!.id,
    holeNumbers: course.teeConfigurations[0]!.holes.map((h) => h.holeNumber),
  };
}

function buildServices() {
  const roundsRepo = createRoundsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const pccService = createPccService(createPccRepository(pool));
  const scoringService = createScoringService(roundsRepo, coursesRepo, pccService);
  const roundsService = createRoundsService(roundsRepo, coursesRepo, scoringService, logger);
  return { roundsRepo, coursesRepo, pccService, scoringService, roundsService };
}

test("recomputeRoundAggregates sums gross/adjusted gross score and totals from the round's real hole scores, and computes score_differential using that day's PCC", async () => {
  const { teeConfigurationId, holeNumbers } = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Scoring", lastName: "Tester" });
  const { roundsService, scoringService, roundsRepo } = buildServices();

  // playingHandicap 0 -> no net-double-bogey adjustment kicks in below
  // the cap for these scores (every hole capped at par+2=6).
  const round = await roundsService.createRound({
    playerId: player.id,
    teeConfigurationId,
    playedAt: "2026-05-01T09:00:00.000Z",
    playingHandicap: 0,
  });

  // 18 holes, alternating a normal score and a blow-up hole that gets
  // capped by the net double bogey rule (par 4 -> cap 6).
  for (const holeNumber of holeNumbers) {
    const strokes = holeNumber % 2 === 0 ? 9 : 4; // even holes blow up to 9, capped to 6
    await roundsService.addHoleScore(round.id, { holeNumber, strokes, putts: 2, gir: strokes <= 4, fairwayResult: "hit" });
  }

  const updated = await scoringService.recomputeRoundAggregates(round.id);

  const expectedGross = holeNumbers.reduce((sum, n) => sum + (n % 2 === 0 ? 9 : 4), 0);
  const expectedAdjusted = holeNumbers.reduce((sum, n) => sum + (n % 2 === 0 ? 6 : 4), 0); // even holes capped to 6
  assert.equal(updated.grossScore, expectedGross);
  assert.equal(updated.adjustedGrossScore, expectedAdjusted);
  assert.equal(updated.totalPutts, 18 * 2);
  assert.equal(updated.totalFairwaysHit, 18);

  // score_differential = (113/113) * (adjustedGross - 72 - pcc(=0, no other rounds that day))
  assert.equal(updated.scoreDifferential, Number((expectedAdjusted - 72).toFixed(3)));

  // Round-trips through a fresh read, not just the UPDATE...RETURNING.
  const fetched = await roundsRepo.get(round.id);
  assert.equal(fetched!.scoreDifferential, updated.scoreDifferential);
  assert.equal(fetched!.adjustedGrossScore, expectedAdjusted);
});

test("recomputeRoundAggregates reflects the tee-configuration/day's real PCC when other rounds have already set it", async () => {
  const { teeConfigurationId, holeNumbers } = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const { roundsService, scoringService, pccService, roundsRepo } = buildServices();

  const playedAt = "2026-05-01T09:00:00.000Z";

  // An admin override sets this tee-configuration/day's PCC to 2 before
  // this round is scored.
  await pccService.calculateOrOverride(teeConfigurationId, playedAt, 2, null);

  const player = await players.create({ firstName: "PCC", lastName: "Aware" });
  const round = await roundsService.createRound({ playerId: player.id, teeConfigurationId, playedAt, playingHandicap: 0 });
  for (const holeNumber of holeNumbers) {
    await roundsService.addHoleScore(round.id, { holeNumber, strokes: 4 });
  }

  const updated = await scoringService.recomputeRoundAggregates(round.id);
  // adjustedGross = 18*4 = 72 (no holes exceed the cap). differential =
  // (113/113) * (72 - 72 - 2) = -2.
  assert.equal(updated.adjustedGrossScore, 72);
  assert.equal(updated.scoreDifferential, -2);

  const fetched = await roundsRepo.get(round.id);
  assert.equal(fetched!.scoreDifferential, -2);
});
