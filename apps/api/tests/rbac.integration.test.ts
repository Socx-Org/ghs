import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createSystemSettingsRepository } from "../src/data/system-settings.repository.ts";
import { createSystemSettingsService } from "../src/application/system-settings.service.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import type { User, UserRole } from "../src/data/users.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import { createAuthService } from "../src/application/auth.service.ts";
import { createMfaService } from "../src/application/mfa.service.ts";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createClubsService } from "../src/application/clubs.service.ts";
import { createCoursesService } from "../src/application/courses.service.ts";
import { createAdminUsersService } from "../src/application/admin-users.service.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
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

// ghs#50 (Phase 5 -- Security Hardening). Comprehensive, real HTTP-level
// RBAC and privilege-escalation boundary tests, built from the route
// matrix produced during Phase 5 discovery. Rate limiting (ghs#49) is
// already merged and active in app.ts by the time this file runs --
// overridden to generous thresholds throughout so it never interferes
// with this file's own request volume.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");
const jwtSecret = "rbac-test-secret";

const GENEROUS_OVERRIDE = { limit: 100_000, windowMs: 60_000 };

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE clubs, users, system_settings RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

function buildApp() {
  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const clubsRepo = createClubsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const settingsRepo = createSystemSettingsRepository(pool);
  const notificationsRepository = createNotificationsRepository(pool);

  const authConfig: AuthConfig = {
    jwtSecret,
    jwtAccessExpiresInSeconds: 900,
    jwtRefreshExpiresInSeconds: 2_592_000,
    mfaPendingExpiresInSeconds: 300,
    mfaEncryptionKey: randomBytes(32),
  };

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
  const roundsRepo = createRoundsRepository(pool);
  const pccService = createPccService(createPccRepository(pool));
  const scoringService = createScoringService(roundsRepo, coursesRepo, pccService);
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const recalculationOrchestrator = createRecalculationOrchestrator(pool, roundsRepo, handicapHistoryService, pccService, notificationsRepository, players, logger);
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, players, systemSettingsService, logger);
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService,
    playersRepository: players, authProvider,
    rateLimitOverrides: { general: GENEROUS_OVERRIDE, auth: GENEROUS_OVERRIDE, sensitiveIp: GENEROUS_OVERRIDE, sensitiveEmail: GENEROUS_OVERRIDE },
  });

  return { app, users, players, authProvider };
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

let userCounter = 0;
async function createUserWithRole(
  ctx: ReturnType<typeof buildApp>,
  role: UserRole,
): Promise<{ user: User; token: string }> {
  userCounter += 1;
  const user = await ctx.users.create({
    email: `rbac-${role}-${userCounter}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role,
    status: "active",
  });
  const tokens = await ctx.authProvider.issueTokens(user, ["pwd"]);
  return { user, token: tokens.accessToken };
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ---------------------------------------------------------------------
// Full route-matrix walk: every admin-gated route from Phase 5
// discovery, real HTTP, player vs admin vs super_admin. player must be
// rejected (401/403); admin and super_admin must clear the
// authorization gate (i.e. never 401/403 -- the underlying business
// operation's own success/failure is that route's own existing test
// suite's concern, not this file's).
// ---------------------------------------------------------------------

interface RouteCase {
  name: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

const ADMIN_GATED_ROUTES: RouteCase[] = [
  { name: "POST /clubs", method: "POST", path: "/clubs", body: { name: "RBAC Test Club" } },
  { name: "POST /courses", method: "POST", path: "/courses", body: { name: "RBAC Test Course" } },
  // ghs#99.
  { name: "PATCH /courses/:id", method: "PATCH", path: "/courses/00000000-0000-0000-0000-000000000000", body: { name: "RBAC Test Course Update" } },
  { name: "DELETE /courses/:id", method: "DELETE", path: "/courses/00000000-0000-0000-0000-000000000000" },
  {
    name: "POST /courses/:id/tee-configurations",
    method: "POST",
    path: "/courses/00000000-0000-0000-0000-000000000000/tee-configurations",
    body: { name: "RBAC Tee", holeCount: 18, courseRating: 72, slopeRating: 113, holes: [] },
  },
  {
    name: "PATCH /tee-configurations/:id",
    method: "PATCH",
    path: "/tee-configurations/00000000-0000-0000-0000-000000000000",
    body: { name: "RBAC Tee", holeCount: 18, courseRating: 72, slopeRating: 113, holes: [] },
  },
  { name: "DELETE /tee-configurations/:id", method: "DELETE", path: "/tee-configurations/00000000-0000-0000-0000-000000000000" },
  { name: "GET /admin/tee-configurations/:id/pcc", method: "GET", path: "/admin/tee-configurations/00000000-0000-0000-0000-000000000000/pcc?playedOn=2026-05-01" },
  { name: "PATCH /admin/tee-configurations/:id/pcc", method: "PATCH", path: "/admin/tee-configurations/00000000-0000-0000-0000-000000000000/pcc", body: { playedOn: "2026-05-01", pcc: 0 } },
  { name: "GET /admin/settings", method: "GET", path: "/admin/settings" },
  { name: "PUT /admin/settings/maintenance-mode", method: "PUT", path: "/admin/settings/maintenance-mode", body: { value: false } },
  { name: "PUT /admin/settings/self-registration-enabled", method: "PUT", path: "/admin/settings/self-registration-enabled", body: { value: false } },
  { name: "PUT /admin/settings/notifications/:type", method: "PUT", path: "/admin/settings/notifications/round-submitted", body: { value: true } },
  { name: "PATCH /admin/users/:id/status", method: "PATCH", path: "/admin/users/00000000-0000-0000-0000-000000000000/status", body: { status: "active" } },
  { name: "DELETE /admin/users/:id/mfa", method: "DELETE", path: "/admin/users/00000000-0000-0000-0000-000000000000/mfa" },
  // ghs#98. The dummy UUID never matches the caller's own real id (a
  // fresh Postgres-generated UUID per createUserWithRole call below), so
  // this never trips the self-deletion guard -- that's covered by its
  // own dedicated test further down.
  { name: "GET /admin/users", method: "GET", path: "/admin/users" },
  { name: "DELETE /admin/users/:id", method: "DELETE", path: "/admin/users/00000000-0000-0000-0000-000000000000" },
  // requireAdmin runs before the route body -- a dummy UUID still proves
  // the authorization gate (player 401/403; admin/super_admin clear it
  // and reach RoundNotFoundError -> 404, never 401/403), same pattern
  // already used above for PATCH /admin/tee-configurations/:id/pcc.
  { name: "PATCH /rounds/:id/status", method: "PATCH", path: "/rounds/00000000-0000-0000-0000-000000000000/status", body: { status: "approved" } },
  // ghs#147: DELETE /rounds/:id is deliberately NOT in this admin-gated
  // matrix any more -- a player may now delete their own round too
  // (status-restricted), so a dummy UUID reaches the route's own
  // 404-before-403 ordering (RoundNotFoundError) for a player just like
  // it does for an admin, not a 401/403. Its own ownership/status-
  // restriction behaviour is covered by dedicated tests in
  // round-workflow.integration.test.ts instead.
  { name: "POST /players/:id/handicap-overrides", method: "POST", path: "/players/00000000-0000-0000-0000-000000000000/handicap-overrides", body: { newIndex: 10.0, reason: "RBAC matrix test" } },
  // ghs#61 -- a real list endpoint, no dummy-ID path param needed; the
  // authorization gate is exercised identically either way.
  { name: "GET /admin/rounds/pending", method: "GET", path: "/admin/rounds/pending" },
  // ghs#100 -- same rationale as GET /admin/rounds/pending above.
  { name: "GET /admin/rounds", method: "GET", path: "/admin/rounds" },
];

for (const route of ADMIN_GATED_ROUTES) {
  test(`RBAC matrix: ${route.name} -- player is rejected, admin and super_admin clear the authorization gate`, async () => {
    const ctx = buildApp();
    await withServer(ctx.app, async (baseUrl) => {
      const player = await createUserWithRole(ctx, "player");
      const admin = await createUserWithRole(ctx, "admin");
      const superAdmin = await createUserWithRole(ctx, "super_admin");

      const fetchAs = (token: string) =>
        fetch(`${baseUrl}/api/v1${route.path}`, {
          method: route.method,
          headers: authHeader(token),
          body: route.body ? JSON.stringify(route.body) : undefined,
        });

      const playerRes = await fetchAs(player.token);
      assert.ok(playerRes.status === 401 || playerRes.status === 403, `player must be rejected -- got ${playerRes.status}`);

      const adminRes = await fetchAs(admin.token);
      assert.ok(adminRes.status !== 401 && adminRes.status !== 403, `admin must clear the authorization gate -- got ${adminRes.status}`);

      const superAdminRes = await fetchAs(superAdmin.token);
      assert.ok(superAdminRes.status !== 401 && superAdminRes.status !== 403, `super_admin must clear the authorization gate -- got ${superAdminRes.status}`);
    });
  });
}

test("no route accepts an unauthenticated request for an admin-gated operation (POST /clubs as a real example)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/clubs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No Auth Club" }),
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------
// ghs#99 review fix, PR #131: PATCH /courses/:id used the `in` operator
// on the parsed JSON body, which throws a TypeError (-> unhandled 500)
// for any non-object top-level JSON value -- a real, valid case
// express.json() will happily parse.
// ---------------------------------------------------------------------

for (const [label, body] of [["null", "null"], ["a string", '"oops"'], ["a number", "42"]] as const) {
  test(`PATCH /courses/:id returns 400, not a 500 crash, for a JSON body that is ${label}`, async () => {
    const ctx = buildApp();
    await withServer(ctx.app, async (baseUrl) => {
      const admin = await createUserWithRole(ctx, "admin");

      const res = await fetch(`${baseUrl}/api/v1/courses/00000000-0000-0000-0000-000000000000`, {
        method: "PATCH",
        headers: authHeader(admin.token),
        body,
      });

      assert.equal(res.status, 400);
    });
  });
}

// ---------------------------------------------------------------------
// POST /admin/users: the confirmed gap and its fix -- only super_admin
// may create/promote to admin or super_admin.
// ---------------------------------------------------------------------

test("admin may create a player account", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST",
      headers: authHeader(admin.token),
      body: JSON.stringify({ email: "new-player@example.com", password: "player-pw-123", role: "player", firstName: "New", lastName: "Player", autoActivate: true }),
    });
    assert.equal(res.status, 201);
  });
});

test("admin CANNOT create an admin account -- 403, not a silent downgrade to player (ghs#50's own confirmed gap)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST",
      headers: authHeader(admin.token),
      body: JSON.stringify({ email: "escalation-attempt@example.com", password: "escalation-pw-123", role: "admin", firstName: "Escalation", lastName: "Attempt", autoActivate: true }),
    });
    assert.equal(res.status, 403);

    const created = await ctx.users.findByEmail("escalation-attempt@example.com");
    assert.equal(created, null, "no account was created at all -- rejected outright, not silently created as a player");
  });
});

test("admin CANNOT create a super_admin account -- the exact escalation path found during discovery (an admin creating a super_admin, setting its own password, and logging in as it)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST",
      headers: authHeader(admin.token),
      body: JSON.stringify({ email: "self-service-super-admin@example.com", password: "escalation-pw-123", role: "super_admin", firstName: "Self", lastName: "Service", autoActivate: true }),
    });
    assert.equal(res.status, 403);
    assert.equal(await ctx.users.findByEmail("self-service-super-admin@example.com"), null);
  });
});

test("super_admin may create player, admin, and super_admin accounts", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    for (const role of ["player", "admin", "super_admin"] as const) {
      const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
        method: "POST",
        headers: authHeader(superAdmin.token),
        body: JSON.stringify({ email: `super-admin-created-${role}@example.com`, password: "super-admin-pw-123", role, firstName: "Created", lastName: role, autoActivate: true }),
      });
      assert.equal(res.status, 201, `super_admin creating role=${role} should succeed`);
    }
  });
});

// ---------------------------------------------------------------------
// No self role-change; invalid role values rejected at both layers;
// role cannot be smuggled through an unrelated endpoint.
// ---------------------------------------------------------------------

test("PATCH /admin/users/:id/status ignores a smuggled role field -- only status changes, never role", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const player = await createUserWithRole(ctx, "player");

    const res = await fetch(`${baseUrl}/api/v1/admin/users/${player.user.id}/status`, {
      method: "PATCH",
      headers: authHeader(superAdmin.token),
      body: JSON.stringify({ status: "active", role: "super_admin" }),
    });
    assert.equal(res.status, 200);

    const reloaded = await ctx.users.findById(player.user.id);
    assert.equal(reloaded!.role, "player", "a role field smuggled into the status-update body must have no effect -- no role-mutation endpoint exists at all, by design");
  });
});

test("a role field smuggled into an unrelated endpoint (round creation) has no effect", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    await ctx.players.create({ userId: player.user.id, firstName: "Smuggle", lastName: "Test" });
    const ownPlayer = await ctx.players.findByUserId(player.user.id);

    const coursesRepo = createCoursesRepository(pool);
    const course = await coursesRepo.create({
      name: "Smuggle Test Course", country: "ES",
      teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113, holes: [] }],
    });

    const res = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST",
      headers: authHeader(player.token),
      body: JSON.stringify({
        playerId: ownPlayer!.id, teeConfigurationId: course.teeConfigurations[0]!.id, playedAt: "2026-05-01T09:00:00.000Z",
        role: "super_admin", // smuggled -- rounds.ts has no concept of "role" in its input shape at all
      }),
    });
    assert.equal(res.status, 201, "the smuggled field is simply ignored, not an error");

    const reloadedUser = await ctx.users.findById(player.user.id);
    assert.equal(reloadedUser!.role, "player", "the caller's own persisted role is completely unaffected by any request body field");
  });
});

test("invalid role values are rejected at the input-validation layer (POST /admin/users)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    for (const badRole of ["viewer", "SuperAdmin", "", "administrator"]) {
      const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
        method: "POST",
        headers: authHeader(superAdmin.token),
        body: JSON.stringify({ email: `bad-role-${badRole || "empty"}@example.com`, password: "bad-role-pw-123", role: badRole, firstName: "Bad", lastName: "Role", autoActivate: true }),
      });
      assert.equal(res.status, 400, `role=${JSON.stringify(badRole)} must be rejected as invalid input, including 'viewer' specifically -- it must not be introduced through the application layer`);
    }
  });
});

test("'viewer' cannot be introduced through the database model either -- rejected by the CHECK constraint even bypassing the application layer entirely", async () => {
  // Asserts on the SQLSTATE code (23514 = check_violation), not the
  // human-readable message -- the message text varies across Postgres
  // versions/locales and would make this test brittle (review comment,
  // PR #52).
  await assert.rejects(
    () => pool.query("INSERT INTO users (email, password_hash, role, status) VALUES ('viewer-bypass@example.com', 'x', 'viewer', 'active')"),
    (err: unknown) => (err as { code?: string }).code === "23514",
  );
});

// ---------------------------------------------------------------------
// ghs#98: GET /admin/users, DELETE /admin/users/:id, GET /auth/me,
// POST /auth/change-password.
// ---------------------------------------------------------------------

test("GET /admin/users returns real accounts with the expected shape, never a password hash", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST",
      headers: authHeader(superAdmin.token),
      body: JSON.stringify({ email: "http-list@example.com", password: "http-list-pw-1", role: "player", firstName: "Http", lastName: "List", autoActivate: true }),
    });

    const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: authHeader(superAdmin.token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.total >= 2, "at least the seeded super_admin and the just-created player");
    const created = body.items.find((i: { email: string }) => i.email === "http-list@example.com");
    assert.ok(created);
    assert.equal(created.firstName, "Http");
    assert.equal("passwordHash" in created, false);
    assert.equal("password_hash" in created, false);
  });
});

test("GET /admin/users?role=invalid is rejected at input validation, not silently ignored", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const res = await fetch(`${baseUrl}/api/v1/admin/users?role=viewer`, { headers: authHeader(superAdmin.token) });
    assert.equal(res.status, 400);
  });
});

test("GET /admin/users rejects a repeated role/status query param (parsed as an array) instead of silently dropping the filter (review finding, PR #121)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");

    const roleRes = await fetch(`${baseUrl}/api/v1/admin/users?role=admin&role=player`, { headers: authHeader(superAdmin.token) });
    assert.equal(roleRes.status, 400, "an array-valued role must be rejected, not treated as no filter");

    const statusRes = await fetch(`${baseUrl}/api/v1/admin/users?status=active&status=disabled`, { headers: authHeader(superAdmin.token) });
    assert.equal(statusRes.status, 400, "an array-valued status must be rejected, not treated as no filter");
  });
});

test("DELETE /admin/users/:id soft-deletes a different user", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const target = await createUserWithRole(ctx, "player");

    const res = await fetch(`${baseUrl}/api/v1/admin/users/${target.user.id}`, { method: "DELETE", headers: authHeader(superAdmin.token) });
    assert.equal(res.status, 200);

    const reloaded = await ctx.users.findById(target.user.id);
    assert.equal(reloaded!.status, "deleted");
  });
});

test("DELETE /admin/users/:id rejects an admin attempting to delete their own account", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");

    const res = await fetch(`${baseUrl}/api/v1/admin/users/${admin.user.id}`, { method: "DELETE", headers: authHeader(admin.token) });
    assert.equal(res.status, 400);

    const reloaded = await ctx.users.findById(admin.user.id);
    assert.equal(reloaded!.status, "active", "the rejected self-deletion attempt made no change at all");
  });
});

test("GET /auth/me returns the caller's own account info, including for an admin with no players row", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: authHeader(admin.token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, admin.user.email);
    assert.equal(body.role, "admin");
    assert.equal(body.firstName, null);
  });
});

test("GET /auth/me requires authentication", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(res.status, 401);
  });
});

test("POST /auth/change-password: real flow, then the old password is rejected and the new one works", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const created = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST",
      headers: authHeader(superAdmin.token),
      body: JSON.stringify({ email: "http-change-pw@example.com", password: "http-original-pw", role: "player", firstName: "Http", lastName: "ChangePw", autoActivate: true }),
    });
    const { userId } = await created.json();
    const tokens = await ctx.authProvider.issueTokens((await ctx.users.findById(userId))!, ["pwd"]);

    const changeRes = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: authHeader(tokens.accessToken),
      body: JSON.stringify({ currentPassword: "http-original-pw", newPassword: "http-brand-new-pw" }),
    });
    assert.equal(changeRes.status, 200);

    const loginOld = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "http-change-pw@example.com", password: "http-original-pw" }),
    });
    assert.equal(loginOld.status, 401);

    const loginNew = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "http-change-pw@example.com", password: "http-brand-new-pw" }),
    });
    assert.equal(loginNew.status, 200);
  });
});

test("POST /auth/change-password rejects an incorrect current password", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: authHeader(player.token),
      body: JSON.stringify({ currentPassword: "totally-wrong", newPassword: "new-password-123" }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /auth/change-password rejects a disabled account even with the correct current password, and its still-valid access token (review finding, PR #121)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const created = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST",
      headers: authHeader(superAdmin.token),
      body: JSON.stringify({ email: "http-change-pw-disabled@example.com", password: "http-original-pw", role: "player", firstName: "Http", lastName: "Disabled", autoActivate: true }),
    });
    const { userId } = await created.json();
    const tokens = await ctx.authProvider.issueTokens((await ctx.users.findById(userId))!, ["pwd"]);

    await fetch(`${baseUrl}/api/v1/admin/users/${userId}/status`, {
      method: "PATCH",
      headers: authHeader(superAdmin.token),
      body: JSON.stringify({ status: "disabled" }),
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: authHeader(tokens.accessToken),
      body: JSON.stringify({ currentPassword: "http-original-pw", newPassword: "http-brand-new-pw" }),
    });
    assert.equal(res.status, 400, "the disabled account's still-valid access token must not be enough to change its password");
    const body = await res.json();
    // The specific, accurate error -- not the generic "current password
    // is incorrect" message this used to be misreported as before the
    // fix (review finding, PR #121).
    assert.equal(body.error, "account not active");
  });
});

test("POST /auth/change-password requires authentication", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "a", newPassword: "brand-new-password" }),
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------
// ghs#106: POST /auth/activate's three distinguishable failure codes,
// over real HTTP -- the frontend's activation-landing screen renders
// different UI per code, so the wire contract itself (not just the
// service-layer error class) needs proving.
// ---------------------------------------------------------------------

async function activationToken(baseUrl: string, adminToken: string, email: string): Promise<{ token: string; userId: string }> {
  const created = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: "POST",
    headers: authHeader(adminToken),
    body: JSON.stringify({ email, password: "activation-test-pw", role: "player", firstName: "Activation", lastName: "Test", autoActivate: false }),
  });
  const { userId } = await created.json();
  const outbox = await pool.query<{ payload: { token: string } }>(
    `SELECT o.payload FROM notification_outbox o
     JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.user_id = $1 AND h.event_type = 'account_activation_admin_invite'
     ORDER BY o.created_at DESC LIMIT 1`,
    [userId],
  );
  return { token: outbox.rows[0]!.payload.token, userId };
}

test("POST /auth/activate: 200 on a real valid token, then a real unknown token is invalid_token", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const { token } = await activationToken(baseUrl, superAdmin.token, "http-activate-ok@example.com");

    const okRes = await fetch(`${baseUrl}/api/v1/auth/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(okRes.status, 200);

    const unknownRes = await fetch(`${baseUrl}/api/v1/auth/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "this-token-was-never-issued" }),
    });
    assert.equal(unknownRes.status, 400);
    assert.deepEqual(await unknownRes.json(), { error: "invalid_token" });
  });
});

test("POST /auth/activate: already_used_token on a real token's second use", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const { token } = await activationToken(baseUrl, superAdmin.token, "http-activate-reused@example.com");

    await fetch(`${baseUrl}/api/v1/auth/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const secondRes = await fetch(`${baseUrl}/api/v1/auth/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(secondRes.status, 400);
    assert.deepEqual(await secondRes.json(), { error: "already_used_token" });
  });
});

test("POST /auth/activate: expired_token for a real token whose real row is backdated in Postgres", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const { token, userId } = await activationToken(baseUrl, superAdmin.token, "http-activate-expired@example.com");

    // Real token state manipulated directly in Postgres -- the 24h TTL
    // can't be waited out in a test.
    await pool.query("UPDATE account_activation_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [userId]);

    const res = await fetch(`${baseUrl}/api/v1/auth/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "expired_token" });
  });
});

// ---------------------------------------------------------------------
// ghs#107: POST /auth/password-reset/confirm's three distinguishable
// failure codes, over real HTTP -- same reasoning as the activation
// tests above (ghs#106), applied to the sibling flow.
// ---------------------------------------------------------------------

async function passwordResetToken(baseUrl: string, adminToken: string, email: string): Promise<{ token: string; userId: string }> {
  const created = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: "POST",
    headers: authHeader(adminToken),
    body: JSON.stringify({ email, password: "reset-test-original-pw", role: "player", firstName: "Reset", lastName: "Test", autoActivate: true }),
  });
  const { userId } = await created.json();
  await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const outbox = await pool.query<{ payload: { token: string } }>(
    `SELECT o.payload FROM notification_outbox o
     JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.user_id = $1 AND h.event_type = 'password_reset'
     ORDER BY o.created_at DESC LIMIT 1`,
    [userId],
  );
  return { token: outbox.rows[0]!.payload.token, userId };
}

test("POST /auth/password-reset/confirm: 200 on a real valid token, then a real unknown token is invalid_token", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const { token } = await passwordResetToken(baseUrl, superAdmin.token, "http-reset-ok@example.com");

    const okRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "http-reset-new-pw" }),
    });
    assert.equal(okRes.status, 200);

    const unknownRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "this-token-was-never-issued", newPassword: "irrelevant-pw" }),
    });
    assert.equal(unknownRes.status, 400);
    assert.deepEqual(await unknownRes.json(), { error: "invalid_token" });
  });
});

test("POST /auth/password-reset/confirm: already_used_token on a real token's second use", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const { token } = await passwordResetToken(baseUrl, superAdmin.token, "http-reset-reused@example.com");

    await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "http-reset-first-pw" }),
    });
    const secondRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "http-reset-second-pw" }),
    });
    assert.equal(secondRes.status, 400);
    assert.deepEqual(await secondRes.json(), { error: "already_used_token" });
  });
});

test("POST /auth/password-reset/confirm: expired_token for a real token whose real row is backdated in Postgres", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const superAdmin = await createUserWithRole(ctx, "super_admin");
    const { token, userId } = await passwordResetToken(baseUrl, superAdmin.token, "http-reset-expired@example.com");

    await pool.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [userId]);

    const res = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "irrelevant-pw" }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "expired_token" });
  });
});

// ---------------------------------------------------------------------
// Authentication boundary: JWT signature verification is what makes
// role-based authorization trustworthy at all. Retained as verification
// of the EXISTING boundary (jwt.verify, already in place since Phase 1),
// not as new authentication architecture.
// ---------------------------------------------------------------------

test("a JWT with a role claim re-signed under the WRONG secret is rejected -- signature verification, not just claim-shape-reading, is what's actually enforced", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const forgedToken = jwt.sign(
      { sub: "00000000-0000-0000-0000-000000000000", email: "forged@example.com", email_verified: true, amr: ["pwd"], ghs_role: "super_admin", tokenType: "access" },
      "a-completely-different-secret-the-attacker-made-up",
      { expiresIn: 900 },
    );
    const res = await fetch(`${baseUrl}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${forgedToken}` } });
    assert.equal(res.status, 401, "a token signed with the wrong secret must be rejected outright, regardless of how privileged its claims claim to be");
  });
});

test("a completely unsigned JWT ('alg: none') is rejected", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "x", ghs_role: "super_admin", tokenType: "access" })).toString("base64url");
    const unsignedToken = `${header}.${payload}.`;

    const res = await fetch(`${baseUrl}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${unsignedToken}` } });
    assert.equal(res.status, 401);
  });
});

test("a token with a tampered payload (same header/signature, altered ghs_role claim) is rejected", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    const parts = player.token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1]!, "base64url").toString()), ghs_role: "super_admin" })).toString("base64url");
    const tamperedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

    const res = await fetch(`${baseUrl}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${tamperedToken}` } });
    assert.equal(res.status, 401, "changing the payload invalidates the signature -- the tampered claim is never trusted");
  });
});

// ---------------------------------------------------------------------
// Ownership-based routes: a player may only act on their own linked
// player record; admin/super_admin may act on any player's.
// ---------------------------------------------------------------------

test("ownership boundary: a player cannot view another player's rounds, an admin can", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const playerA = await createUserWithRole(ctx, "player");
    const playerB = await createUserWithRole(ctx, "player");
    const admin = await createUserWithRole(ctx, "admin");
    await ctx.players.create({ userId: playerA.user.id, firstName: "A", lastName: "Player" });
    const playerBProfile = await ctx.players.create({ userId: playerB.user.id, firstName: "B", lastName: "Player" });

    const asPlayerA = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}/rounds`, { headers: authHeader(playerA.token) });
    assert.equal(asPlayerA.status, 403, "player A cannot list player B's rounds");

    const asAdmin = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}/rounds`, { headers: authHeader(admin.token) });
    assert.equal(asAdmin.status, 200, "an admin can list any player's rounds");
  });
});

test("ownership boundary: a player CAN view their own rounds", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    const playerProfile = await ctx.players.create({ userId: player.user.id, firstName: "Own", lastName: "Player" });

    const res = await fetch(`${baseUrl}/api/v1/players/${playerProfile.id}/rounds`, { headers: authHeader(player.token) });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------
// ghs#101: GET /players/:playerId/handicap-history and GET
// /players/:playerId/stats -- same ownership boundary as the rounds
// sub-resource above (createPlayerAccessAuthorizer, reused not
// reinvented).
// ---------------------------------------------------------------------

test("ownership boundary: a player cannot view another player's handicap history, an admin can", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const playerA = await createUserWithRole(ctx, "player");
    const playerB = await createUserWithRole(ctx, "player");
    const admin = await createUserWithRole(ctx, "admin");
    await ctx.players.create({ userId: playerA.user.id, firstName: "A", lastName: "Player" });
    const playerBProfile = await ctx.players.create({ userId: playerB.user.id, firstName: "B", lastName: "Player" });

    const asPlayerA = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}/handicap-history`, { headers: authHeader(playerA.token) });
    assert.equal(asPlayerA.status, 403, "player A cannot view player B's handicap history");

    const asAdmin = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}/handicap-history`, { headers: authHeader(admin.token) });
    assert.equal(asAdmin.status, 200, "an admin can view any player's handicap history");
    assert.deepEqual(await asAdmin.json(), [], "a real, empty array (no history yet) -- not an error");
  });
});

test("ownership boundary: a player CAN view their own handicap history", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    const playerProfile = await ctx.players.create({ userId: player.user.id, firstName: "Own", lastName: "Player" });

    const res = await fetch(`${baseUrl}/api/v1/players/${playerProfile.id}/handicap-history`, { headers: authHeader(player.token) });
    assert.equal(res.status, 200);
  });
});

test("ownership boundary: a player cannot view another player's stats, an admin can", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const playerA = await createUserWithRole(ctx, "player");
    const playerB = await createUserWithRole(ctx, "player");
    const admin = await createUserWithRole(ctx, "admin");
    await ctx.players.create({ userId: playerA.user.id, firstName: "A", lastName: "Player" });
    const playerBProfile = await ctx.players.create({ userId: playerB.user.id, firstName: "B", lastName: "Player" });

    const asPlayerA = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}/stats`, { headers: authHeader(playerA.token) });
    assert.equal(asPlayerA.status, 403, "player A cannot view player B's stats");

    const asAdmin = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}/stats`, { headers: authHeader(admin.token) });
    assert.equal(asAdmin.status, 200, "an admin can view any player's stats");
    const body = await asAdmin.json();
    assert.equal(body.roundsCount, 0, "no approved rounds yet -- a real zero, not an error");
    assert.equal(body.girPercentage, null, "null, not NaN or a misleading 0, when there's nothing to divide by yet");
  });
});

test("ownership boundary: a player CAN view their own stats", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    const playerProfile = await ctx.players.create({ userId: player.user.id, firstName: "Own", lastName: "Player" });

    const res = await fetch(`${baseUrl}/api/v1/players/${playerProfile.id}/stats`, { headers: authHeader(player.token) });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------
// GET /players/:id (ghs#60) -- same ownership boundary as the rounds/
// handicap-overrides sub-resources above, now for the player record
// itself.
// ---------------------------------------------------------------------

test("ownership boundary: a player cannot view another player's profile, an admin can, a 403 leaks no existence information", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const playerA = await createUserWithRole(ctx, "player");
    const playerB = await createUserWithRole(ctx, "player");
    const admin = await createUserWithRole(ctx, "admin");
    await ctx.players.create({ userId: playerA.user.id, firstName: "A", lastName: "Player" });
    const playerBProfile = await ctx.players.create({ userId: playerB.user.id, firstName: "B", lastName: "Player" });

    const asPlayerA = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}`, { headers: authHeader(playerA.token) });
    assert.equal(asPlayerA.status, 403, "player A cannot view player B's profile");

    // Authorization is checked before the existence check (route-layer
    // ordering, ghs#60) -- an unauthorized caller gets the exact same
    // 403 for a real player ID as for one that doesn't exist at all,
    // proven directly below.
    const missingId = "00000000-0000-0000-0000-000000000000";
    const asPlayerAForMissing = await fetch(`${baseUrl}/api/v1/players/${missingId}`, { headers: authHeader(playerA.token) });
    assert.equal(asPlayerAForMissing.status, 403, "a real player's ID and a nonexistent one are indistinguishable to an unauthorized caller");

    const asAdmin = await fetch(`${baseUrl}/api/v1/players/${playerBProfile.id}`, { headers: authHeader(admin.token) });
    assert.equal(asAdmin.status, 200, "an admin can view any player's profile");
    const body = await asAdmin.json();
    assert.equal(body.firstName, "B");
  });
});

test("ownership boundary: a player CAN view their own profile, including their (initially null) handicap index", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    const playerProfile = await ctx.players.create({ userId: player.user.id, firstName: "Own", lastName: "Player" });

    const res = await fetch(`${baseUrl}/api/v1/players/${playerProfile.id}`, { headers: authHeader(player.token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, playerProfile.id);
    assert.equal(body.firstName, "Own");
    // Real, additive fields (ghs#60) -- null until a real WHS
    // calculation or admin override ever sets them, not omitted.
    assert.equal(body.handicapIndex, null);
    assert.equal(body.lowHandicapIndex, null);
    // userId is an internal auth-linkage key, not profile data -- must
    // never appear in the wire response, even for the player's own
    // profile (review finding, PR #75).
    assert.equal("userId" in body, false, "userId must not appear in the response DTO at all");
  });
});

test("GET /players/:id returns 404 for a genuinely nonexistent player, once authorized (admin)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");
    const res = await fetch(`${baseUrl}/api/v1/players/00000000-0000-0000-0000-000000000000`, { headers: authHeader(admin.token) });
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------
// GET /players/me (ghs#89) -- resolves the caller's own player id, no
// URL-supplied target to authorize against.
// ---------------------------------------------------------------------

test("GET /players/me returns the caller's own profile", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const player = await createUserWithRole(ctx, "player");
    const playerProfile = await ctx.players.create({ userId: player.user.id, firstName: "Own", lastName: "Player" });

    const res = await fetch(`${baseUrl}/api/v1/players/me`, { headers: authHeader(player.token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, playerProfile.id);
    assert.equal(body.firstName, "Own");
    assert.equal(body.lastName, "Player");
    // Same DTO shape as GET /players/:id, not a narrower one (review
    // finding, PR #90) -- these are real, additive fields (ghs#60), null
    // until a WHS calculation or admin override ever sets them.
    assert.equal(body.handicapIndex, null);
    assert.equal(body.lowHandicapIndex, null);
    assert.equal("userId" in body, false, "userId must not appear in the response DTO, same as GET /players/:id");
  });
});

test("GET /players/me returns 404 for an account with no linked player row (e.g. an admin never given one)", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");
    const res = await fetch(`${baseUrl}/api/v1/players/me`, { headers: authHeader(admin.token) });
    assert.equal(res.status, 404);
    // The specific error payload the route sets, not just the status
    // (review finding, PR #90) -- guards the actual wire contract, not
    // only that *some* 404 comes back.
    const body = await res.json();
    assert.equal(body.error, "no player profile linked to this account");
  });
});

test("GET /players/me requires authentication", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/players/me`);
    assert.equal(res.status, 401);
  });
});

test("GET /players/me is not shadowed by GET /players/:id -- registering /me first does not break a real player-ID lookup", async () => {
  const ctx = buildApp();
  await withServer(ctx.app, async (baseUrl) => {
    const admin = await createUserWithRole(ctx, "admin");
    const player = await createUserWithRole(ctx, "player");
    const playerProfile = await ctx.players.create({ userId: player.user.id, firstName: "Real", lastName: "Id" });

    const res = await fetch(`${baseUrl}/api/v1/players/${playerProfile.id}`, { headers: authHeader(admin.token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, playerProfile.id);
  });
});
