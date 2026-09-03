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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  // presence_snapshots included (ghs#195): not FK-linked to users, so
  // CASCADE from the users truncate above wouldn't touch it -- without
  // this, a row left behind by presence-snapshots.repository.integration.
  // test.ts (run order/database is shared across files in this suite)
  // would silently flip hasHistory to true here.
  await pool.query("TRUNCATE clubs, users, system_settings, presence_snapshots RESTART IDENTITY CASCADE");
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
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, users, coursesRepo, createPresenceSnapshotsRepository(pool), systemSettingsService, logger);

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

test("GET /dashboard/admin requires authentication", async () => {
  const { app } = buildApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/dashboard/admin`);
    assert.equal(response.status, 401);
  });
});

test("GET /dashboard/admin is admin/super_admin-gated -- a plain player is rejected", async () => {
  const { app, adminUsersService, authService } = buildApp();
  await withServer(app, async (baseUrl) => {
    await adminUsersService.adminCreateUser({
      email: "admin-dashboard-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Admin", lastName: "DashboardPlayer", autoActivate: true,
    });
    const login = await authService.login("admin-dashboard-player@example.com", "player-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");

    const response = await fetch(`${baseUrl}/api/v1/dashboard/admin`, {
      headers: { Authorization: `Bearer ${login.tokens.accessToken}` },
    });
    assert.equal(response.status, 403);
  });
});

test("GET /dashboard/admin rejects an invalid period, and accepts every real one (7d/30d/90d)", async () => {
  const { app, adminUsersService, authService } = buildApp();
  await withServer(app, async (baseUrl) => {
    await adminUsersService.adminCreateUser({
      email: "admin-dashboard-period@example.com", password: "admin-pw-1", role: "admin",
      firstName: "Admin", lastName: "Period", autoActivate: true,
    });
    const login = await authService.login("admin-dashboard-period@example.com", "admin-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");
    const headers = { Authorization: `Bearer ${login.tokens.accessToken}` };

    const invalid = await fetch(`${baseUrl}/api/v1/dashboard/admin?period=14d`, { headers });
    assert.equal(invalid.status, 400);

    for (const period of ["7d", "30d", "90d"]) {
      const response = await fetch(`${baseUrl}/api/v1/dashboard/admin?period=${period}`, { headers });
      assert.equal(response.status, 200, `period=${period} should be accepted`);
      const body = await response.json() as { userTrends: { data: unknown[] } };
      assert.equal(body.userTrends.data.length, Number(period.replace("d", "")), `period=${period} returns exactly that many days`);
    }

    // No ?period at all -- defaults to 30d.
    const defaulted = await fetch(`${baseUrl}/api/v1/dashboard/admin`, { headers });
    const defaultedBody = await defaulted.json() as { userTrends: { data: unknown[] } };
    assert.equal(defaultedBody.userTrends.data.length, 30);
  });
});

test("GET /dashboard/admin: real aggregated response, every section matching a manual calculation against the same seeded Postgres data", async () => {
  const { app, players, coursesRepo, roundsRepo, adminUsersService, authService } = buildApp();
  await withServer(app, async (baseUrl) => {
    // Two courses, two players, a mix of approved and pending rounds --
    // exactly the scenario getTopCourses/getMostActivePlayers' own
    // integration tests already prove the underlying query for; this
    // test's job is proving the HTTP layer wires it all together
    // correctly, not re-deriving the aggregation math from scratch.
    const courseA = await coursesRepo.create({
      name: "Admin Dashboard Course A", country: "ES",
      teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
    });
    const courseB = await coursesRepo.create({
      name: "Admin Dashboard Course B", country: "ES",
      teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
    });
    // ghs#197: three more courses, none with any rounds (so they can't
    // affect topCourses/mostActivePlayers below), purely to exercise
    // totalCourses' own top-2-country breakdown against real seeded
    // data: ES=2 (courses A/B above), then a real alphabetical tie-break
    // between FR and GB (both count 1) -- FR wins second place -- with
    // GB's own course and the null-country course both folding into
    // `others` (2).
    await coursesRepo.create({ name: "Admin Dashboard Course C", country: "GB" });
    await coursesRepo.create({ name: "Admin Dashboard Course D", country: "FR" });
    await coursesRepo.create({ name: "Admin Dashboard Course E" });

    const playerXUser = await adminUsersService.adminCreateUser({
      email: "admin-dashboard-x@example.com", password: "player-pw-1", role: "player",
      firstName: "PlayerX", lastName: "Admin", autoActivate: true,
    });
    const playerYUser = await adminUsersService.adminCreateUser({
      email: "admin-dashboard-y@example.com", password: "player-pw-1", role: "player",
      firstName: "PlayerY", lastName: "Admin", autoActivate: true,
    });
    const admin = await adminUsersService.adminCreateUser({
      email: "admin-dashboard-admin@example.com", password: "admin-pw-1", role: "admin",
      firstName: "Admin", lastName: "Dashboard", autoActivate: true,
    });
    const playerX = await players.findByUserId(playerXUser.userId);
    const playerY = await players.findByUserId(playerYUser.userId);

    // 2 approved rounds on course A for player X, 1 approved on course B
    // for player Y, 1 still-pending round on course A -- must not count
    // toward totalRounds' own approved-implicit ranking queries, but
    // DOES count toward the plain total/pending numbers. The second of
    // player X's approved rounds is 9-hole (ghs#199): 3 eighteen-hole + 1
    // nine-hole, a real mix real enough to prove the split isn't just
    // "everything defaults to 18".
    for (let i = 0; i < 2; i++) {
      const round = await roundsRepo.create({
        playerId: playerX!.id, teeConfigurationId: courseA.teeConfigurations[0]!.id, playedAt: `2026-05-0${i + 1}T09:00:00.000Z`,
        is9Hole: i === 1,
      });
      await roundsRepo.setStatus(round.id, "approved");
    }
    const roundB = await roundsRepo.create({ playerId: playerY!.id, teeConfigurationId: courseB.teeConfigurations[0]!.id, playedAt: "2026-05-10T09:00:00.000Z" });
    await roundsRepo.setStatus(roundB.id, "approved");
    const pendingRound = await roundsRepo.create({ playerId: playerX!.id, teeConfigurationId: courseA.teeConfigurations[0]!.id, playedAt: "2026-05-11T09:00:00.000Z" });
    // A fresh round defaults to 'draft', not 'pending' (ghs#58's
    // draft/in-progress lifecycle) -- set directly rather than going
    // through the real submit workflow, which would also require a
    // complete set of hole scores (ghs#92) this test has no other use
    // for.
    await roundsRepo.setStatus(pendingRound.id, "pending");

    // Presence: playerX heartbeated 2 minutes ago (active), admin never
    // did (last_active_at stays NULL).
    await pool.query("UPDATE users SET last_active_at = now() - INTERVAL '2 minutes' WHERE id = $1", [playerX!.userId]);

    const login = await authService.login("admin-dashboard-admin@example.com", "admin-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");
    const response = await fetch(`${baseUrl}/api/v1/dashboard/admin`, {
      headers: { Authorization: `Bearer ${login.tokens.accessToken}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      totalUsers: { data: { total: number; player: number; admin: number; superAdmin: number } };
      totalCourses: { data: { total: number; topCountries: Array<{ country: string; count: number }>; others: number } };
      totalRounds: { data: { total: number; pending: number; eighteenHole: number; nineHole: number } };
      topCourses: { data: Array<{ courseId: string; courseName: string; roundsCount: number }> };
      mostActivePlayers: { data: Array<{ playerId: string; roundsCount: number; handicapIndex: number | null }> };
      activeRightNow: { data: { current: number; period: string; series: unknown[]; previousSeries: unknown[]; hasHistory: boolean } };
      userTrends: { data: unknown[] };
    };

    assert.deepEqual(body.totalUsers.data, { total: 3, player: 2, admin: 1, superAdmin: 0 });
    assert.deepEqual(body.totalCourses.data, {
      total: 5,
      topCountries: [
        { country: "ES", count: 2 },
        { country: "FR", count: 1 },
      ],
      others: 2, // GB's course + the null-country course
    });
    assert.deepEqual(
      body.totalRounds.data,
      { total: 4, pending: 1, eighteenHole: 3, nineHole: 1 },
      "4 rounds total (3 approved + 1 pending), 1 pending, 3 eighteen-hole + 1 nine-hole",
    );
    assert.deepEqual(body.topCourses.data, [
      { courseId: courseA.id, courseName: "Admin Dashboard Course A", roundsCount: 2 },
      { courseId: courseB.id, courseName: "Admin Dashboard Course B", roundsCount: 1 },
    ]);
    assert.equal(body.mostActivePlayers.data.length, 2);
    assert.equal(body.mostActivePlayers.data[0]!.playerId, playerX!.id);
    assert.equal(body.mostActivePlayers.data[0]!.roundsCount, 2);
    assert.equal(body.activeRightNow.data.current, 1, "only playerX heartbeated within the last 5 minutes");
    assert.equal(body.activeRightNow.data.period, "24h", "default period, no setting configured");
    assert.equal(body.activeRightNow.data.series.length, 96, "24h of 15-minute buckets");
    assert.equal(body.activeRightNow.data.previousSeries.length, 96);
    assert.equal(body.activeRightNow.data.hasHistory, false, "no presence_snapshots rows were seeded in this test");
    assert.equal(body.userTrends.data.length, 30, "default period");
  });
});
