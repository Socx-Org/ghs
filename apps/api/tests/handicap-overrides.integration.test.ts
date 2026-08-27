import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createHandicapOverridesRepository } from "../src/data/handicap-overrides.repository.ts";
import { createHandicapOverridesService } from "../src/application/handicap-overrides.service.ts";
import { createHandicapHistoryRepository } from "../src/data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "../src/application/handicap-history.service.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createSystemSettingsRepository } from "../src/data/system-settings.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import { createAuthService } from "../src/application/auth.service.ts";
import { createMfaService } from "../src/application/mfa.service.ts";
import { createAdminUsersService } from "../src/application/admin-users.service.ts";
import { createClubsService } from "../src/application/clubs.service.ts";
import { createCoursesService } from "../src/application/courses.service.ts";
import { createSystemSettingsService } from "../src/application/system-settings.service.ts";
import { createRoundsService } from "../src/application/rounds.service.ts";
import { createApp } from "../src/interface/http/app.ts";
import type { AuthConfig } from "../src/config.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE clubs, users RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

test("create then list round-trips through a real database", async () => {
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Handicap", lastName: "Test" });
  const overrides = createHandicapOverridesRepository(pool);

  const created = await overrides.create({
    playerId: player.id,
    adminUserId: (await createAdminUser()).userId,
    previousIndex: 15.0,
    newIndex: 13.5,
    reason: "Verified against a paper handicap certificate",
  });

  assert.equal(created.newIndex, 13.5);
  const history = await overrides.listForPlayer(player.id);
  assert.equal(history.length, 1);
});

test("multiple overrides for the same player accumulate as history, not overwrite -- real database proof", async () => {
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "History", lastName: "Test" });
  const overrides = createHandicapOverridesRepository(pool);
  const adminUserId = (await createAdminUser()).userId;

  await overrides.create({ playerId: player.id, adminUserId, newIndex: 12.0, reason: "First correction" });
  await overrides.create({ playerId: player.id, adminUserId, previousIndex: 12.0, newIndex: 10.5, reason: "Second correction" });
  await overrides.create({ playerId: player.id, adminUserId, previousIndex: 10.5, newIndex: 9.8, reason: "Third correction" });

  const history = await overrides.listForPlayer(player.id);
  assert.equal(history.length, 3, "every override is a new row, never an in-place update");
  // Most recent first (ORDER BY created_at DESC).
  assert.equal(history[0]!.newIndex, 9.8);
  assert.equal(history[2]!.newIndex, 12.0);
});

test("an override without a reason is rejected at the database level, not only in application code", async () => {
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "No", lastName: "Reason" });
  const overrides = createHandicapOverridesRepository(pool);
  const adminUserId = (await createAdminUser()).userId;

  await assert.rejects(() =>
    pool.query(
      "INSERT INTO handicap_overrides (player_id, admin_user_id, new_index, reason) VALUES ($1, $2, $3, NULL)",
      [player.id, adminUserId, 10.0],
    ),
  );
});

async function createAdminUser(): Promise<{ userId: string }> {
  const users = createUsersRepository(pool);
  const admin = await users.create({
    email: `admin-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });
  return { userId: admin.id };
}

test("HTTP: a player can view their own handicap override history but not another player's; only admin can create one", async () => {
  const authConfig: AuthConfig = {
    jwtSecret: "handicap-overrides-test-secret",
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
  const overridesRepo = createHandicapOverridesRepository(pool);
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
  const handicapOverridesService = createHandicapOverridesService(pool, overridesRepo, handicapHistoryService, notificationsRepository, players, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator,
    playersRepository: players, authProvider,
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const admin = await adminUsersService.adminCreateUser({
      email: "override-admin@example.com", password: "admin-pw-1", role: "admin",
      firstName: "Override", lastName: "Admin", autoActivate: true,
    });
    const playerA = await adminUsersService.adminCreateUser({
      email: "override-player-a@example.com", password: "player-a-pw-1", role: "player",
      firstName: "Player", lastName: "A", autoActivate: true,
    });
    const playerB = await adminUsersService.adminCreateUser({
      email: "override-player-b@example.com", password: "player-b-pw-1", role: "player",
      firstName: "Player", lastName: "B", autoActivate: true,
    });
    const playerARecord = await players.findByUserId(playerA.userId);
    const playerBRecord = await players.findByUserId(playerB.userId);

    const adminLogin = await authService.login("override-admin@example.com", "admin-pw-1");
    const playerALogin = await authService.login("override-player-a@example.com", "player-a-pw-1");
    if (adminLogin.status !== "authenticated" || playerALogin.status !== "authenticated") throw new Error("unreachable");
    const adminToken = adminLogin.tokens.accessToken;
    const playerAToken = playerALogin.tokens.accessToken;

    // Player A cannot create an override for themselves.
    const playerCreateResponse = await fetch(`${baseUrl}/api/v1/players/${playerARecord!.id}/handicap-overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${playerAToken}` },
      body: JSON.stringify({ newIndex: 10.0, reason: "Self-override attempt" }),
    });
    assert.equal(playerCreateResponse.status, 403);

    // Admin creates a real override for Player A.
    const adminCreateResponse = await fetch(`${baseUrl}/api/v1/players/${playerARecord!.id}/handicap-overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ previousIndex: 14.0, newIndex: 12.0, reason: "Admin-verified correction" }),
    });
    assert.equal(adminCreateResponse.status, 201);

    // Player A can view their own history.
    const ownHistoryResponse = await fetch(`${baseUrl}/api/v1/players/${playerARecord!.id}/handicap-overrides`, {
      headers: { Authorization: `Bearer ${playerAToken}` },
    });
    assert.equal(ownHistoryResponse.status, 200);
    const ownHistory = await ownHistoryResponse.json() as unknown[];
    assert.equal(ownHistory.length, 1);

    // Player A cannot view Player B's history.
    const otherHistoryResponse = await fetch(`${baseUrl}/api/v1/players/${playerBRecord!.id}/handicap-overrides`, {
      headers: { Authorization: `Bearer ${playerAToken}` },
    });
    assert.equal(otherHistoryResponse.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
