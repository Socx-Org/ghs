import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createSystemSettingsRepository } from "../src/data/system-settings.repository.ts";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
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
import { createApp } from "../src/interface/http/app.ts";
import type { AuthConfig } from "../src/config.ts";

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

async function createTeeConfiguration(courseRating = 72.0, slopeRating = 113): Promise<string> {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Test Course",
    country: "ES",
    teeConfigurations: [
      { name: "White", holeCount: 18, courseRating, slopeRating, holes: [] },
    ],
  });
  return course.teeConfigurations[0]!.id;
}

async function createAdminUserId(): Promise<string> {
  const users = createUsersRepository(pool);
  const admin = await users.create({
    email: `pcc-admin-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });
  return admin.id;
}

async function createScoredRound(teeConfigurationId: string, playedAt: string, adjustedGrossScore: number): Promise<string> {
  const players = createPlayersRepository(pool);
  const rounds = createRoundsRepository(pool);
  const player = await players.create({ firstName: "PCC", lastName: "Tester" });
  const round = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt });
  await rounds.updateScores(round.id, { adjustedGrossScore });
  return round.id;
}

test("getOrCreateDailyPcc: defaults to pcc=0/source='calculated' when no rounds exist yet, and never touches rounds", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const service = createPccService(createPccRepository(pool));

  const dailyPcc = await service.getOrCreateDailyPcc(teeConfigurationId, "2026-05-01");
  assert.equal(dailyPcc.pcc, 0);
  assert.equal(dailyPcc.source, "calculated");
  assert.equal(dailyPcc.playedOn, "2026-05-01");

  // Idempotent -- calling again returns the same row, not a second insert
  // (the UNIQUE(tee_configuration_id, played_on) constraint would reject
  // a second insert if this weren't a real upsert).
  const again = await service.getOrCreateDailyPcc(teeConfigurationId, "2026-05-01");
  assert.equal(again.id, dailyPcc.id);
});

test("calculateOrOverride with pccOverride=null computes from real rounds and bulk-rewrites their score_differential", async () => {
  const teeConfigurationId = await createTeeConfiguration(72.0, 113); // slope 113 -> 113/113 = 1, differential == (ags - cr)
  const rounds = createRoundsRepository(pool);

  // diff = 90 - 72 = 18 -> average 18 -> bucket 3
  const roundId = await createScoredRound(teeConfigurationId, "2026-05-01T09:00:00.000Z", 90);

  const service = createPccService(createPccRepository(pool));
  const result = await service.calculateOrOverride(teeConfigurationId, "2026-05-01", null, null);

  assert.equal(result.dailyPcc.pcc, 3);
  assert.equal(result.dailyPcc.source, "calculated");
  assert.equal(result.updatedRounds, 1);

  const fetched = await rounds.get(roundId);
  assert.equal(fetched!.scoreDifferential, Number((((113 / 113) * (90 - 72 - 3))).toFixed(3)));
});

test("calculateOrOverride with an explicit value bulk-rewrites every round on that tee-configuration/day, attributed to the acting admin", async () => {
  const teeConfigurationId = await createTeeConfiguration(72.0, 113);
  const rounds = createRoundsRepository(pool);

  const roundA = await createScoredRound(teeConfigurationId, "2026-05-01T09:00:00.000Z", 90);
  const roundB = await createScoredRound(teeConfigurationId, "2026-05-01T14:00:00.000Z", 80);
  // A different day -- must not be touched by this day's override.
  const roundOtherDay = await createScoredRound(teeConfigurationId, "2026-05-02T09:00:00.000Z", 90);

  const adminUserId = await createAdminUserId();
  const service = createPccService(createPccRepository(pool));
  const result = await service.calculateOrOverride(teeConfigurationId, "2026-05-01", 2, adminUserId);

  assert.equal(result.dailyPcc.pcc, 2);
  assert.equal(result.dailyPcc.source, "override");
  assert.equal(result.dailyPcc.updatedBy, adminUserId);
  assert.equal(result.updatedRounds, 2);

  const fetchedA = await rounds.get(roundA);
  const fetchedB = await rounds.get(roundB);
  const fetchedOtherDay = await rounds.get(roundOtherDay);
  assert.equal(fetchedA!.scoreDifferential, Number((((113 / 113) * (90 - 72 - 2))).toFixed(3)));
  assert.equal(fetchedB!.scoreDifferential, Number((((113 / 113) * (80 - 72 - 2))).toFixed(3)));
  assert.equal(fetchedOtherDay!.scoreDifferential, null, "a different day's round must not be touched");
});

test("a round with no adjusted_gross_score yet is excluded from both the calculation and the bulk rewrite", async () => {
  const teeConfigurationId = await createTeeConfiguration(72.0, 113);
  const players = createPlayersRepository(pool);
  const rounds = createRoundsRepository(pool);
  const player = await players.create({ firstName: "Unscored", lastName: "Round" });
  const unscored = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  const adminUserId = await createAdminUserId();
  const service = createPccService(createPccRepository(pool));
  const result = await service.calculateOrOverride(teeConfigurationId, "2026-05-01", 1, adminUserId);

  assert.equal(result.updatedRounds, 0);
  const fetched = await rounds.get(unscored.id);
  assert.equal(fetched!.pcc, null, "an unscored round is never touched by a PCC rewrite");
  assert.equal(fetched!.scoreDifferential, null, "an unscored round is never touched by a PCC rewrite");
});

test("rejects an out-of-range override for real, against a real database, not just the fake repository in unit tests", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const adminUserId = await createAdminUserId();
  const service = createPccService(createPccRepository(pool));
  await assert.rejects(() => service.calculateOrOverride(teeConfigurationId, "2026-05-01", 4, adminUserId));
});

test("HTTP: admin can calculate/override PCC for a tee-configuration/day; a player cannot", async () => {
  const authConfig: AuthConfig = {
    jwtSecret: "pcc-test-secret",
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

    const admin = await adminUsersService.adminCreateUser({
      email: "pcc-admin@example.com", password: "admin-pw-1", role: "admin",
      firstName: "PCC", lastName: "Admin", autoActivate: true,
    });
    const player = await adminUsersService.adminCreateUser({
      email: "pcc-player@example.com", password: "player-pw-1", role: "player",
      firstName: "PCC", lastName: "Player", autoActivate: true,
    });

    const adminLogin = await authService.login("pcc-admin@example.com", "admin-pw-1");
    const playerLogin = await authService.login("pcc-player@example.com", "player-pw-1");
    if (adminLogin.status !== "authenticated" || playerLogin.status !== "authenticated") throw new Error("unreachable");

    const playerResponse = await fetch(`${baseUrl}/api/v1/admin/tee-configurations/${teeConfigurationId}/pcc`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${playerLogin.tokens.accessToken}` },
      body: JSON.stringify({ playedOn: "2026-05-01", pcc: 1 }),
    });
    assert.equal(playerResponse.status, 403);

    const adminResponse = await fetch(`${baseUrl}/api/v1/admin/tee-configurations/${teeConfigurationId}/pcc`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminLogin.tokens.accessToken}` },
      body: JSON.stringify({ playedOn: "2026-05-01", pcc: 1 }),
    });
    assert.equal(adminResponse.status, 200);
    const body = await adminResponse.json() as { dailyPcc: { pcc: number; source: string } };
    assert.equal(body.dailyPcc.pcc, 1);
    assert.equal(body.dailyPcc.source, "override");

    void player; void admin;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
