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
import { createPresenceSnapshotsRepository } from "../src/data/presence-snapshots.repository.ts";
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
import { createDashboardService } from "../src/application/dashboard.service.ts";
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

test("listByPlayer (ghs#147): real course/tee names joined in, ordered newest-played-first, scoped to the requesting player only", async () => {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "My Rounds Test Course", country: "ES",
    teeConfigurations: [{ name: "Blue", holeCount: 18, courseRating: 71.2, slopeRating: 128, holes: [] }],
  });
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "MyRounds", lastName: "Test" });
  const otherPlayer = await players.create({ firstName: "Other", lastName: "Player" });
  const rounds = createRoundsRepository(pool);

  const older = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  const newer = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-05T09:00:00.000Z" });
  await rounds.create({ playerId: otherPlayer.id, teeConfigurationId, playedAt: "2026-05-06T09:00:00.000Z" });

  const list = await rounds.listByPlayer(player.id);

  assert.equal(list.length, 2, "only this player's own rounds, not the other player's");
  assert.deepEqual(list.map((r) => r.id), [newer.id, older.id], "newest played date first");
  assert.equal(list[0]!.courseName, "My Rounds Test Course");
  assert.equal(list[0]!.teeConfigurationName, "Blue");
  assert.equal(list[0]!.courseId, course.id);
  assert.equal(list[0]!.teeConfigurationId, teeConfigurationId);
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
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, players, systemSettingsService, logger);
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, users, coursesRepo, createPresenceSnapshotsRepository(pool), systemSettingsService, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService, playersRepository: players, authProvider,
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
    const createOwnResponse = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ playerId: playerARecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    assert.equal(createOwnResponse.status, 201);

    // Player A attempts to submit a round for Player B -- forbidden.
    const createOtherResponse = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ playerId: playerBRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    assert.equal(createOtherResponse.status, 403);

    // Player A cannot approve their own round.
    const ownRound = await createOwnResponse.json() as { id: string };
    const statusResponse = await fetch(`${baseUrl}/api/v1/rounds/${ownRound.id}/status`, {
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
    const invalidHoleResponse = await fetch(`${baseUrl}/api/v1/rounds/${ownRound.id}/holes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ holeNumber: 1, strokes: 4 }),
    });
    assert.equal(invalidHoleResponse.status, 400);
    const invalidHoleBody = await invalidHoleResponse.json() as { error: string };
    assert.match(invalidHoleBody.error, /no hole metadata/);

    // ghs#169: a real HTTP round-trip for the new played-at update path.
    const updateDateResponse = await fetch(`${baseUrl}/api/v1/rounds/${ownRound.id}/played-at`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ playedAt: "2026-06-15T09:00:00.000Z" }),
    });
    assert.equal(updateDateResponse.status, 200);
    const updateDateBody = await updateDateResponse.json() as { round: { playedAt: string } };
    assert.equal(updateDateBody.round.playedAt, "2026-06-15T09:00:00.000Z");

    // Review fix: an unparseable playedAt must be rejected at the HTTP
    // boundary (400), not reach the TIMESTAMPTZ column and surface as a
    // raw, unhandled Postgres error (500).
    const invalidDateResponse = await fetch(`${baseUrl}/api/v1/rounds/${ownRound.id}/played-at`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ playedAt: "not-a-date" }),
    });
    assert.equal(invalidDateResponse.status, 400);
    const invalidDateBody = await invalidDateResponse.json() as { error: string };
    assert.match(invalidDateBody.error, /ISO 8601/);

    // Review fix: a bare "YYYY-MM-DD" is real, Date.parse()-parseable
    // input -- but not the real contract (a genuine ISO date-*time*,
    // the shape playedAtToIsoString always produces). A bare date would
    // otherwise reach Postgres and be interpreted as midnight in the
    // *server's* session timezone, not a real, unambiguous instant --
    // exactly the class of bug this app's own timezone-safety convention
    // exists to avoid.
    const bareDateResponse = await fetch(`${baseUrl}/api/v1/rounds/${ownRound.id}/played-at`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ playedAt: "2026-06-15" }),
    });
    assert.equal(bareDateResponse.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP: submit rejects an incomplete round with 409, and re-POSTing a hole updates it (200) rather than erroring (ghs#92)", async () => {
  const authConfig: AuthConfig = {
    jwtSecret: "rounds-test-secret-92",
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
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, players, systemSettingsService, logger);
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, users, coursesRepo, createPresenceSnapshotsRepository(pool), systemSettingsService, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService, playersRepository: players, authProvider,
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Real hole metadata, unlike this file's shared createTeeConfiguration()
    // helper -- needed for both the completeness check and to add a real
    // hole score at all (computeHoleAdjustment needs real hole metadata).
    const course = await coursesRepo.create({
      name: "Completeness Test Course",
      country: "ES",
      teeConfigurations: [{
        name: "White", holeCount: 18, courseRating: 68.0, slopeRating: 113,
        holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 1 }],
      }],
    });
    const teeConfigurationId = course.teeConfigurations[0]!.id;

    const playerUser = await adminUsersService.adminCreateUser({
      email: "completeness-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Completeness", lastName: "Player", autoActivate: true,
    });
    const playerRecord = await players.findByUserId(playerUser.userId);
    const login = await authService.login("completeness-player@example.com", "player-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${login.tokens.accessToken}` };

    const createResponse = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST", headers,
      body: JSON.stringify({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    const round = await createResponse.json() as { id: string };

    // Missing its one required hole score -- 409, not a raw 500.
    const incompleteSubmit = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/submit`, { method: "POST", headers });
    assert.equal(incompleteSubmit.status, 409);
    const incompleteBody = await incompleteSubmit.json() as { error: string };
    assert.match(incompleteBody.error, /0 of 1 required hole scores/);

    // First recording of hole 1 -- 200, not 201 (ghs#92: this is now a
    // real upsert, "record this hole's score," not a strict REST create).
    const firstHole = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/holes`, {
      method: "POST", headers, body: JSON.stringify({ holeNumber: 1, strokes: 6, putts: 3, gir: true }),
    });
    assert.equal(firstHole.status, 200);

    // Re-recording the SAME hole, correcting only strokes -- updates in
    // place, still 200, no unique-violation 500, and (review finding,
    // PR #93) does NOT wipe putts/gir just because this request omits
    // them -- the route must send undefined for an omitted field, not
    // coerce it to false, or the real upsert's COALESCE-preserve
    // behaviour never gets a chance to apply.
    const correctedHole = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/holes`, {
      method: "POST", headers, body: JSON.stringify({ holeNumber: 1, strokes: 4 }),
    });
    assert.equal(correctedHole.status, 200);

    const afterCorrection = await fetch(`${baseUrl}/api/v1/rounds/${round.id}`, { headers });
    const roundAfterCorrection = await afterCorrection.json() as {
      holeScores: Array<{ holeNumber: number; strokes: number; putts: number | null; gir: boolean }>;
    };
    assert.equal(roundAfterCorrection.holeScores.length, 1, "still exactly one row for hole 1, not two");
    assert.equal(roundAfterCorrection.holeScores[0]!.strokes, 4, "the corrected value");
    assert.equal(roundAfterCorrection.holeScores[0]!.putts, 3, "preserved -- this correction never mentioned putts");
    assert.equal(roundAfterCorrection.holeScores[0]!.gir, true, "preserved -- this correction never mentioned gir");

    // Now complete -- submit succeeds.
    const completeSubmit = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/submit`, { method: "POST", headers });
    assert.equal(completeSubmit.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP: submitting a round computes its real score immediately, before any approval (ghs#168 -- scoring moved from approval time to submission time)", async () => {
  const authConfig: AuthConfig = {
    jwtSecret: "rounds-test-secret-168",
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
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, players, systemSettingsService, logger);
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, users, coursesRepo, createPresenceSnapshotsRepository(pool), systemSettingsService, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService, playersRepository: players, authProvider,
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const course = await coursesRepo.create({
      name: "ghs#168 Submission Scoring Course",
      country: "ES",
      teeConfigurations: [{
        name: "White", holeCount: 18, courseRating: 68.0, slopeRating: 113,
        holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 1 }],
      }],
    });
    const teeConfigurationId = course.teeConfigurations[0]!.id;

    const playerUser = await adminUsersService.adminCreateUser({
      email: "submission-scoring-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Submission", lastName: "Scoring", autoActivate: true,
    });
    const playerRecord = await players.findByUserId(playerUser.userId);
    const login = await authService.login("submission-scoring-player@example.com", "player-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${login.tokens.accessToken}` };

    const createResponse = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST", headers,
      body: JSON.stringify({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    const round = await createResponse.json() as { id: string };

    await fetch(`${baseUrl}/api/v1/rounds/${round.id}/holes`, {
      method: "POST", headers, body: JSON.stringify({ holeNumber: 1, strokes: 6 }),
    });

    // Before submission -- unscored (draft never gets rescored).
    const beforeSubmit = await fetch(`${baseUrl}/api/v1/rounds/${round.id}`, { headers });
    const roundBeforeSubmit = await beforeSubmit.json() as { grossScore: number | null; scoreDifferential: number | null };
    assert.equal(roundBeforeSubmit.grossScore, null);
    assert.equal(roundBeforeSubmit.scoreDifferential, null);

    const submitResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/submit`, { method: "POST", headers });
    assert.equal(submitResponse.status, 200);

    // Immediately after submission -- still 'pending', not approved, but
    // already carrying a real score. This is the exact chicken-and-egg
    // problem ghs#168 fixes: an admin building the Daily PCC screen needs
    // to see this round's real adjusted_gross_score before approving
    // anything, and a player must never be blocked from submitting more
    // rounds on this tee/day while the first sits pending.
    const afterSubmit = await fetch(`${baseUrl}/api/v1/rounds/${round.id}`, { headers });
    const roundAfterSubmit = await afterSubmit.json() as {
      status: string; grossScore: number | null; adjustedGrossScore: number | null; scoreDifferential: number | null;
    };
    assert.equal(roundAfterSubmit.status, "pending");
    assert.equal(roundAfterSubmit.grossScore, 6);
    assert.ok(roundAfterSubmit.adjustedGrossScore !== null, "a real adjusted gross score, computed at submission, not left null until approval");
    assert.ok(roundAfterSubmit.scoreDifferential !== null, "a real score differential, computed at submission, not left null until approval");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("getPlayerStats (ghs#101/#176): real aggregation math over approved rounds' hole_scores, scoped to the player and excluding non-approved rounds", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  // ghs#176: a second, distinct course -- round2 below is played here
  // instead of teeConfigurationId's course. round3 further below is a
  // third approved round back on teeConfigurationId's course -- with it,
  // roundsCount (3) and coursesCount (2) are genuinely different numbers
  // (review finding, PR #183: without a third round, both were 2, so an
  // implementation bug that returned roundsCount -- or count(DISTINCT
  // r.id) again by copy-paste -- instead of a real COUNT(DISTINCT
  // tc.course_id) would still have passed this assertion).
  const courses = createCoursesRepository(pool);
  const secondCourse = await courses.create({
    name: "Second Test Course",
    country: "ES",
    teeConfigurations: [{ name: "Blue", holeCount: 18, courseRating: 70.5, slopeRating: 120, holes: [] }],
  });
  const secondTeeConfigurationId = secondCourse.teeConfigurations[0]!.id;
  const roundsRepo = createRoundsRepository(pool);
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Stats", lastName: "Player" });
  const otherPlayer = await players.create({ firstName: "Other", lastName: "Player" });

  // Round 1 (approved): 3 holes exercising every dimension --
  // gir/fairway_result (including a null, e.g. a par-3)/in_sand/putts.
  const round1 = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round1.id, { holeNumber: 1, strokes: 4, gir: true, fairwayResult: "hit", inSand: false, putts: 1, penalties: 0 });
  await roundsRepo.addHoleScore(round1.id, { holeNumber: 2, strokes: 6, gir: false, fairwayResult: "missed_left", inSand: true, putts: 2, penalties: 1 });
  await roundsRepo.addHoleScore(round1.id, { holeNumber: 3, strokes: 5, gir: false, fairwayResult: undefined, inSand: false, putts: 3, penalties: 0 });
  await roundsRepo.setStatus(round1.id, "approved");

  // Round 2 (approved): 2 more holes, on the second course.
  const round2 = await roundsRepo.create({ playerId: player.id, teeConfigurationId: secondTeeConfigurationId, playedAt: "2026-05-02T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round2.id, { holeNumber: 1, strokes: 4, gir: true, fairwayResult: "missed_right", inSand: false, putts: 1, penalties: 0 });
  await roundsRepo.addHoleScore(round2.id, { holeNumber: 2, strokes: 7, gir: false, fairwayResult: "hit", inSand: true, putts: 4, penalties: 2 });
  await roundsRepo.setStatus(round2.id, "approved");

  // Round 3 (approved): back on the FIRST course -- makes roundsCount
  // (3) and coursesCount (2) genuinely different, see this test's own
  // opening comment for why that matters.
  const round3 = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round3.id, { holeNumber: 1, strokes: 4, gir: true, fairwayResult: "hit", inSand: false, putts: 2, penalties: 0 });
  await roundsRepo.setStatus(round3.id, "approved");

  // Round 4 (still pending): must be entirely excluded from the
  // aggregation -- a round only genuinely represents real play once
  // approved, matching listApprovedDifferentialsForPlayer's own
  // reasoning. If this leaked in, every assertion below would be wrong.
  const pendingRound = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-04T09:00:00.000Z" });
  await roundsRepo.addHoleScore(pendingRound.id, { holeNumber: 1, strokes: 3, gir: true, fairwayResult: "hit", inSand: false, putts: 1, penalties: 0 });
  await roundsRepo.setStatus(pendingRound.id, "pending");

  // Another player's approved round -- must not leak into this player's
  // own stats.
  const otherRound = await roundsRepo.create({ playerId: otherPlayer.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.addHoleScore(otherRound.id, { holeNumber: 1, strokes: 10, gir: false, fairwayResult: "missed_left", inSand: true, putts: 5, penalties: 3 });
  await roundsRepo.setStatus(otherRound.id, "approved");

  const stats = await roundsRepo.getPlayerStats(player.id);

  assert.equal(stats.roundsCount, 3);
  assert.equal(stats.coursesCount, 2, "round1 and round3 share a course; round2 is on a second, distinct one");
  assert.equal(stats.holesCount, 6);
  assert.equal(stats.girPercentage, 50.0, "3 of 6 holes -> 50%");
  // 5 fairway-relevant holes (round1's null-fairway_result hole excluded
  // from the denominator, not counted as a miss).
  assert.equal(stats.fairwayHitPercentage, 60.0, "3 of 5 relevant holes -> 60%");
  assert.equal(stats.fairwayMissedLeftPercentage, 20.0, "1 of 5 relevant holes -> 20%");
  assert.equal(stats.fairwayMissedRightPercentage, 20.0, "1 of 5 relevant holes -> 20%");
  assert.equal(stats.sandInteractionPercentage, 33.3, "2 of 6 holes had a sand interaction -> 33.3%, NOT a shot count");
  assert.equal(stats.puttsHolesCount, 6, "every hole in this fixture has putts recorded");
  assert.equal(stats.onePuttHoles, 2);
  assert.equal(stats.threePlusPuttHoles, 2, "the putts=3 hole and the putts=4 hole both count");
  assert.equal(stats.puttsPerRound, 4.3, "(1+2+3+1+4+2)=13 putts over 3 rounds -> 4.333... -> 4.3");
  assert.equal(stats.penaltiesPerRound, 1.0, "(0+1+0+0+2+0)=3 penalties over 3 rounds -> 1.0");
});

test("getPlayerStats (ghs#178 review fix, PR #184): puttsHolesCount excludes holes with strokes but no putts recorded, and puttsPerRound is null (not a misleading 0) when NO hole has putts data", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const roundsRepo = createRoundsRepository(pool);
  const players = createPlayersRepository(pool);

  // A player whose rounds were entered without ever recording putts --
  // a real, legitimate case (putts is optional per hole), not
  // hypothetical. holesCount must still count these holes; puttsHolesCount
  // must not.
  const noPuttsPlayer = await players.create({ firstName: "NoPutts", lastName: "Player" });
  const round = await roundsRepo.create({ playerId: noPuttsPlayer.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round.id, { holeNumber: 1, strokes: 4, gir: true, fairwayResult: "hit", inSand: false, penalties: 0 });
  await roundsRepo.addHoleScore(round.id, { holeNumber: 2, strokes: 5, gir: false, fairwayResult: "missed_left", inSand: false, penalties: 0 });
  await roundsRepo.setStatus(round.id, "approved");

  const noPuttsStats = await roundsRepo.getPlayerStats(noPuttsPlayer.id);
  assert.equal(noPuttsStats.holesCount, 2, "the holes themselves are real and counted");
  assert.equal(noPuttsStats.puttsHolesCount, 0, "but none of them have putts recorded");
  assert.equal(noPuttsStats.puttsPerRound, null, "null, not 0 -- 0 total putts across real holes is never a genuine value");
  assert.equal(noPuttsStats.onePuttHoles, 0);
  assert.equal(noPuttsStats.threePlusPuttHoles, 0);

  // A second player with a MIX -- some holes have putts, some don't --
  // proving puttsHolesCount is the real per-hole count, not just an
  // all-or-nothing flag.
  const mixedPlayer = await players.create({ firstName: "Mixed", lastName: "Player" });
  const mixedRound = await roundsRepo.create({ playerId: mixedPlayer.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.addHoleScore(mixedRound.id, { holeNumber: 1, strokes: 4, putts: 2, penalties: 0 });
  await roundsRepo.addHoleScore(mixedRound.id, { holeNumber: 2, strokes: 5, penalties: 0 });
  await roundsRepo.addHoleScore(mixedRound.id, { holeNumber: 3, strokes: 3, putts: 1, penalties: 0 });
  await roundsRepo.setStatus(mixedRound.id, "approved");

  const mixedStats = await roundsRepo.getPlayerStats(mixedPlayer.id);
  assert.equal(mixedStats.holesCount, 3);
  assert.equal(mixedStats.puttsHolesCount, 2, "only holes 1 and 3 have putts recorded");
  assert.equal(mixedStats.puttsPerRound, 3.0, "(2+1)=3 putts over 1 round -> 3.0, averaged per round not per putts-hole");
  assert.equal(mixedStats.onePuttHoles, 1);
});

test("getPlayerStats (ghs#101): a player with no approved rounds gets real zeros/nulls, not an error", async () => {
  const players = createPlayersRepository(pool);
  const roundsRepo = createRoundsRepository(pool);
  const player = await players.create({ firstName: "No", lastName: "Rounds" });

  const stats = await roundsRepo.getPlayerStats(player.id);

  assert.equal(stats.roundsCount, 0);
  assert.equal(stats.coursesCount, 0);
  assert.equal(stats.holesCount, 0);
  assert.equal(stats.puttsHolesCount, 0);
  assert.equal(stats.girPercentage, null, "null, not NaN or a misleading 0, when there's nothing to divide by");
  assert.equal(stats.fairwayHitPercentage, null);
  assert.equal(stats.puttsPerRound, null);
  assert.equal(stats.penaltiesPerRound, null);
  assert.equal(stats.sandInteractionPercentage, null);
  assert.equal(stats.onePuttHoles, 0);
  assert.equal(stats.threePlusPuttHoles, 0);
});

test("getTopCourses (ghs#180): real GROUP BY ranking over approved rounds, ordered by count, excluding pending rounds and soft-deleted courses", async () => {
  const courses = createCoursesRepository(pool);
  const roundsRepo = createRoundsRepository(pool);
  const players = createPlayersRepository(pool);

  const courseA = await courses.create({
    name: "Top Courses A", country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
  });
  const courseB = await courses.create({
    name: "Top Courses B", country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
  });
  const courseC = await courses.create({
    name: "Top Courses C (soft-deleted)", country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
  });
  const teeA = courseA.teeConfigurations[0]!.id;
  const teeB = courseB.teeConfigurations[0]!.id;
  const teeC = courseC.teeConfigurations[0]!.id;

  const player = await players.create({ firstName: "Ranking", lastName: "Player" });

  // Course A: 3 approved rounds.
  for (let i = 0; i < 3; i++) {
    const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId: teeA, playedAt: `2026-05-0${i + 1}T09:00:00.000Z` });
    await roundsRepo.setStatus(round.id, "approved");
  }
  // Course B: 1 approved round.
  const roundB = await roundsRepo.create({ playerId: player.id, teeConfigurationId: teeB, playedAt: "2026-05-10T09:00:00.000Z" });
  await roundsRepo.setStatus(roundB.id, "approved");
  // Course A: 1 more round, still pending -- must not count.
  await roundsRepo.create({ playerId: player.id, teeConfigurationId: teeA, playedAt: "2026-05-11T09:00:00.000Z" });

  // Course C: a real approved round, but the COURSE itself is
  // soft-deleted afterward -- courses.delete() itself refuses this
  // (CourseHasRoundsError, by design), so the ledger's own soft-delete
  // state is set directly, same "manipulate real state in Postgres, not
  // assumed" convention this file's own pending-round test above uses.
  const roundC = await roundsRepo.create({ playerId: player.id, teeConfigurationId: teeC, playedAt: "2026-05-12T09:00:00.000Z" });
  await roundsRepo.setStatus(roundC.id, "approved");
  await pool.query("UPDATE courses SET deleted_at = now() WHERE id = $1", [courseC.id]);

  const top = await roundsRepo.getTopCourses(5);

  assert.deepEqual(top, [
    { courseId: courseA.id, courseName: "Top Courses A", roundsCount: 3 },
    { courseId: courseB.id, courseName: "Top Courses B", roundsCount: 1 },
  ], "course C is excluded (soft-deleted), and the pending round on course A doesn't inflate its count");
});

test("getTopCourses: limit caps the result set to the real top N", async () => {
  const courses = createCoursesRepository(pool);
  const roundsRepo = createRoundsRepository(pool);
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Limit", lastName: "Player" });

  for (const [name, roundsCount] of [["Limit A", 3], ["Limit B", 2], ["Limit C", 1]] as const) {
    const course = await courses.create({
      name, country: "ES",
      teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
    });
    for (let i = 0; i < roundsCount; i++) {
      const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId: course.teeConfigurations[0]!.id, playedAt: `2026-06-0${i + 1}T09:00:00.000Z` });
      await roundsRepo.setStatus(round.id, "approved");
    }
  }

  const top = await roundsRepo.getTopCourses(2);
  assert.equal(top.length, 2, "only the top 2, not all 3 courses with real rounds");
  assert.equal(top[0]!.courseName, "Limit A");
  assert.equal(top[1]!.courseName, "Limit B");
});

test("getMostActivePlayers (ghs#180): real GROUP BY ranking over approved rounds, including each player's current handicap index, excluding soft-deleted players", async () => {
  const courses = createCoursesRepository(pool);
  const roundsRepo = createRoundsRepository(pool);
  const players = createPlayersRepository(pool);

  const course = await courses.create({
    name: "Most Active Players Course", country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
  });
  const teeId = course.teeConfigurations[0]!.id;

  const playerX = await players.create({ firstName: "Alice", lastName: "Whitfield" });
  const playerY = await players.create({ firstName: "Ben", lastName: "Okafor" });
  const playerZ = await players.create({ firstName: "Carys", lastName: "Deleted" });

  await pool.query("UPDATE players SET handicap_index = 12.4 WHERE id = $1", [playerX.id]);
  await pool.query("UPDATE players SET handicap_index = 8.1 WHERE id = $1", [playerY.id]);

  for (let i = 0; i < 3; i++) {
    const round = await roundsRepo.create({ playerId: playerX.id, teeConfigurationId: teeId, playedAt: `2026-07-0${i + 1}T09:00:00.000Z` });
    await roundsRepo.setStatus(round.id, "approved");
  }
  const roundY = await roundsRepo.create({ playerId: playerY.id, teeConfigurationId: teeId, playedAt: "2026-07-10T09:00:00.000Z" });
  await roundsRepo.setStatus(roundY.id, "approved");

  // playerZ has a real approved round, but the player row is
  // soft-deleted afterward (direct SQL -- players has no repository
  // method that would refuse this the way courses.delete() does).
  const roundZ = await roundsRepo.create({ playerId: playerZ.id, teeConfigurationId: teeId, playedAt: "2026-07-11T09:00:00.000Z" });
  await roundsRepo.setStatus(roundZ.id, "approved");
  await pool.query("UPDATE players SET deleted_at = now() WHERE id = $1", [playerZ.id]);

  const ranking = await roundsRepo.getMostActivePlayers(5);

  assert.deepEqual(ranking, [
    { playerId: playerX.id, playerFirstName: "Alice", playerLastName: "Whitfield", roundsCount: 3, handicapIndex: 12.4 },
    { playerId: playerY.id, playerFirstName: "Ben", playerLastName: "Okafor", roundsCount: 1, handicapIndex: 8.1 },
  ], "playerZ is excluded (soft-deleted)");
});
