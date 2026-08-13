import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createSystemSettingsRepository } from "../src/data/system-settings.repository.ts";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import { createAuthService } from "../src/application/auth.service.ts";
import { createMfaService } from "../src/application/mfa.service.ts";
import { createAdminUsersService } from "../src/application/admin-users.service.ts";
import { createClubsService } from "../src/application/clubs.service.ts";
import { createCoursesService } from "../src/application/courses.service.ts";
import { createSystemSettingsService } from "../src/application/system-settings.service.ts";
import { createRoundsService } from "../src/application/rounds.service.ts";
import { createHandicapOverridesRepository } from "../src/data/handicap-overrides.repository.ts";
import { createHandicapOverridesService } from "../src/application/handicap-overrides.service.ts";
import { createHandicapHistoryRepository } from "../src/data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "../src/application/handicap-history.service.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
import { createApp } from "../src/interface/http/app.ts";
import type { AuthConfig } from "../src/config.ts";
import type { FairwayResult } from "../src/data/rounds.repository.ts";

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

async function createTeeConfiguration(): Promise<string> {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Test Course",
    country: "ES",
    teeConfigurations: [
      {
        name: "White",
        holeCount: 18,
        courseRating: 71.2,
        slopeRating: 128,
        holes: [],
      },
    ],
  });
  return course.teeConfigurations[0]!.id;
}

test("a full 18-hole round round-trips through a real database, including all fairway_result values and null", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Round", lastName: "Tester" });

  const rounds = createRoundsRepository(pool);
  const results: (FairwayResult | undefined)[] = ["hit", "missed_left", "missed_right", undefined];

  const round = await rounds.create({
    playerId: player.id,
    teeConfigurationId,
    playedAt: "2026-05-01T09:00:00.000Z",
    holeScores: Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      strokes: 4,
      fairwayResult: results[i % results.length],
    })),
  });

  const fetched = await rounds.get(round.id);
  assert.equal(fetched!.holeScores.length, 18);
  assert.equal(fetched!.holeScores.filter((h) => h.fairwayResult === "hit").length > 0, true);
  assert.equal(fetched!.holeScores.filter((h) => h.fairwayResult === "missed_left").length > 0, true);
  assert.equal(fetched!.holeScores.filter((h) => h.fairwayResult === "missed_right").length > 0, true);
  assert.equal(fetched!.holeScores.filter((h) => h.fairwayResult === null).length > 0, true);
});

test("an invalid fairway_result is rejected at the database level", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Bad", lastName: "Data" });
  const rounds = createRoundsRepository(pool);

  await assert.rejects(() =>
    rounds.create({
      playerId: player.id,
      teeConfigurationId,
      playedAt: "2026-05-01T09:00:00.000Z",
      // @ts-expect-error -- deliberately invalid, proving the CHECK constraint, not the TypeScript type
      holeScores: [{ holeNumber: 1, strokes: 4, fairwayResult: "sideways" }],
    }),
  );
});

test("WHS-calculated/aggregate round fields round-trip through the repository layer -- found and fixed a real gap (create() never accepted them, no update path existed)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Score", lastName: "Update" });
  const rounds = createRoundsRepository(pool);

  const round = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  assert.equal(round.grossScore, null);
  assert.equal(round.scoreDifferential, null);

  const updated = await rounds.updateScores(round.id, {
    grossScore: 88,
    adjustedGrossScore: 86,
    scoreDifferential: 14.2,
    totalPutts: 32,
    totalGir: 6,
    totalFairwaysHit: 8,
    totalPenalties: 2,
  });

  assert.equal(updated.grossScore, 88);
  assert.equal(updated.adjustedGrossScore, 86);
  assert.equal(updated.scoreDifferential, 14.2);
  assert.equal(updated.totalPutts, 32);
  assert.equal(updated.totalGir, 6);
  assert.equal(updated.totalFairwaysHit, 8);
  assert.equal(updated.totalPenalties, 2);

  // Round-trips through a fresh read too, not just the UPDATE...RETURNING.
  const fetched = await rounds.get(round.id);
  assert.equal(fetched!.scoreDifferential, 14.2);

  // A partial update only touches the fields provided.
  const partiallyUpdated = await rounds.updateScores(round.id, { grossScore: 90 });
  assert.equal(partiallyUpdated.grossScore, 90);
  assert.equal(partiallyUpdated.totalPutts, 32, "fields not included in the update must be left unchanged");
});

test("a round can be created with zero hole scores and have them added incrementally -- the real gameplay workflow the hole-count open question was resolved around", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Incremental", lastName: "Entry" });
  const rounds = createRoundsRepository(pool);

  const round = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  assert.equal((await rounds.get(round.id))!.holeScores.length, 0);

  await rounds.addHoleScore(round.id, { holeNumber: 1, strokes: 4 });
  await rounds.addHoleScore(round.id, { holeNumber: 2, strokes: 5 });

  const midRound = await rounds.get(round.id);
  assert.equal(midRound!.holeScores.length, 2, "a round mid-play is not forced to have all 18 holes");
});

test("HTTP: a player can submit their own round and add hole scores, but not another player's", async () => {
  const authConfig: AuthConfig = {
    jwtSecret: "rounds-test-secret",
    jwtAccessExpiresInSeconds: 900,
    jwtRefreshExpiresInSeconds: 2_592_000,
    mfaPendingExpiresInSeconds: 300,
    mfaEncryptionKey: randomBytes(32),
  };

  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const clubsRepo = createClubsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const settingsRepo = createSystemSettingsRepository(pool);
  const roundsRepo = createRoundsRepository(pool);
  const notificationsRepository = createNotificationsRepository(pool);

  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const systemSettingsService = createSystemSettingsService(settingsRepo);
  const authService = createAuthService({
    pool, logger, authProvider, users, players, activationTokens, passwordResetTokens,
    mfa: mfaRepo, mfaVerifier: mfaService, notifications: notificationsRepository,
  });
  const clubsService = createClubsService(clubsRepo, logger);
  const coursesService = createCoursesService(coursesRepo, logger);
  const adminUsersService = createAdminUsersService(pool, logger, users, players, activationTokens, notificationsRepository);
  const pccService = createPccService(createPccRepository(pool));
  const scoringService = createScoringService(roundsRepo, coursesRepo, pccService);
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const recalculationOrchestrator = createRecalculationOrchestrator(pool, roundsRepo, handicapHistoryService, pccService, notificationsRepository, players, logger);
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, players, logger);
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, playersRepository: players, authProvider,
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const teeConfigurationId = await createTeeConfiguration();

    // Two real player accounts, both active.
    const playerA = await adminUsersService.adminCreateUser({
      email: "player-a@example.com", password: "player-a-pw-1", role: "player",
      firstName: "Player", lastName: "A", autoActivate: true,
    });
    const playerB = await adminUsersService.adminCreateUser({
      email: "player-b@example.com", password: "player-b-pw-1", role: "player",
      firstName: "Player", lastName: "B", autoActivate: true,
    });
    const playerARecord = await players.findByUserId(playerA.userId);
    const playerBRecord = await players.findByUserId(playerB.userId);

    const loginA = await authService.login("player-a@example.com", "player-a-pw-1");
    if (loginA.status !== "authenticated") throw new Error("unreachable");
    const tokenA = loginA.tokens.accessToken;

    // Player A submits their own round -- allowed.
    const createOwnResponse = await fetch(`${baseUrl}/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ playerId: playerARecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    assert.equal(createOwnResponse.status, 201);

    // Player A attempts to submit a round for Player B -- forbidden.
    const createOtherResponse = await fetch(`${baseUrl}/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ playerId: playerBRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    assert.equal(createOtherResponse.status, 403);

    // Player A cannot approve their own round.
    const ownRound = await createOwnResponse.json() as { id: string };
    const statusResponse = await fetch(`${baseUrl}/rounds/${ownRound.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(statusResponse.status, 403);

    // Submitting a hole number the tee configuration has no metadata for
    // is a validation error (400), not an unhandled 500 -- the tee
    // configuration created by createTeeConfiguration() above has no
    // hole metadata at all, so any hole number reaches
    // HoleMetadataNotFoundError (PR #27 review fix).
    const invalidHoleResponse = await fetch(`${baseUrl}/rounds/${ownRound.id}/holes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ holeNumber: 1, strokes: 4 }),
    });
    assert.equal(invalidHoleResponse.status, 400);
    const invalidHoleBody = await invalidHoleResponse.json() as { error: string };
    assert.match(invalidHoleBody.error, /no hole metadata/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
