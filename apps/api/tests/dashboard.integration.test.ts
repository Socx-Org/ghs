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
import { createDashboardService } from "../src/application/dashboard.service.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
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

// Same full composition root every other route-level integration test in
// this suite builds -- GET /dashboard/player is wired through the real
// app, not a hand-rolled subset of it.
function buildApp() {
  const authConfig: AuthConfig = {
    jwtSecret: "dashboard-test-secret",
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
  const dashboardService = createDashboardService(handicapHistoryService, roundsService);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService, playersRepository: players, authProvider,
  });

  return { app, users, players, roundsRepo, coursesRepo, handicapHistoryService, adminUsersService, authService };
}

async function withServer<T>(app: ReturnType<typeof buildApp>["app"], fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /dashboard/player requires authentication", async () => {
  const { app } = buildApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/dashboard/player`);
    assert.equal(response.status, 401);
  });
});

test("GET /dashboard/player 404s for an authenticated account with no linked player profile (e.g. an admin), same real case /players/me already handles", async () => {
  const { app, adminUsersService, authService } = buildApp();
  await withServer(app, async (baseUrl) => {
    await adminUsersService.adminCreateUser({
      email: "admin-no-player@example.com", password: "admin-pw-1", role: "admin",
      firstName: "Admin", lastName: "NoPlayer", autoActivate: true,
    });
    const login = await authService.login("admin-no-player@example.com", "admin-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");

    const response = await fetch(`${baseUrl}/api/v1/dashboard/player`, {
      headers: { Authorization: `Bearer ${login.tokens.accessToken}` },
    });
    assert.equal(response.status, 404);
    const body = await response.json() as { error: string };
    assert.equal(body.error, "no player profile linked to this account");
  });
});

test("GET /dashboard/player: real aggregated response, matching what the underlying endpoints return for the same seeded data", async () => {
  const { app, players, roundsRepo, handicapHistoryService, adminUsersService, authService } = buildApp();
  await withServer(app, async (baseUrl) => {
    const course = await createCoursesRepository(pool).create({
      name: "Dashboard Test Course",
      country: "ES",
      teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 71.2, slopeRating: 128, holes: [] }],
    });
    const teeConfigurationId = course.teeConfigurations[0]!.id;

    const playerUser = await adminUsersService.adminCreateUser({
      email: "dashboard-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Dashboard", lastName: "Player", autoActivate: true,
    });
    const playerRecord = await players.findByUserId(playerUser.userId);
    const login = await authService.login("dashboard-player@example.com", "player-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");
    const headers = { Authorization: `Bearer ${login.tokens.accessToken}` };

    // A real handicap-history row.
    await handicapHistoryService.recordCalculatedResult(playerRecord!.id, 14.2, "2026-05-01T00:00:00.000Z", { differentialsUsed: [14.2] });

    // A real approved round with hole scores, feeding both recentRounds
    // and stats.
    const round = await roundsRepo.create({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
    await roundsRepo.addHoleScore(round.id, { holeNumber: 1, strokes: 4, gir: true, fairwayResult: "hit", inSand: false, putts: 2, penalties: 0 });
    await roundsRepo.setStatus(round.id, "approved");

    const [dashboardResponse, historyResponse, roundsResponse, statsResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/dashboard/player`, { headers }),
      fetch(`${baseUrl}/api/v1/players/${playerRecord!.id}/handicap-history`, { headers }),
      fetch(`${baseUrl}/api/v1/players/${playerRecord!.id}/rounds`, { headers }),
      fetch(`${baseUrl}/api/v1/players/${playerRecord!.id}/stats`, { headers }),
    ]);

    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json() as {
      handicapHistory: { data: unknown };
      recentRounds: { data: unknown };
      stats: { data: unknown };
    };

    assert.deepEqual(dashboard.handicapHistory, { data: await historyResponse.json() });
    assert.deepEqual(dashboard.recentRounds, { data: await roundsResponse.json() });
    assert.deepEqual(dashboard.stats, { data: await statsResponse.json() });
  });
});
