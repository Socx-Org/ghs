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

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService,
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
  { name: "GET /admin/tee-configurations/:id/pcc", method: "GET", path: "/admin/tee-configurations/00000000-0000-0000-0000-000000000000/pcc?playedOn=2026-05-01" },
  { name: "PATCH /admin/tee-configurations/:id/pcc", method: "PATCH", path: "/admin/tee-configurations/00000000-0000-0000-0000-000000000000/pcc", body: { playedOn: "2026-05-01", pcc: 0 } },
  { name: "GET /admin/settings", method: "GET", path: "/admin/settings" },
  { name: "PUT /admin/settings/maintenance-mode", method: "PUT", path: "/admin/settings/maintenance-mode", body: { value: false } },
  { name: "PUT /admin/settings/self-registration-enabled", method: "PUT", path: "/admin/settings/self-registration-enabled", body: { value: false } },
  { name: "PUT /admin/settings/notifications/:type", method: "PUT", path: "/admin/settings/notifications/round-submitted", body: { value: true } },
  { name: "PATCH /admin/users/:id/status", method: "PATCH", path: "/admin/users/00000000-0000-0000-0000-000000000000/status", body: { status: "active" } },
  { name: "DELETE /admin/users/:id/mfa", method: "DELETE", path: "/admin/users/00000000-0000-0000-0000-000000000000/mfa" },
  // requireAdmin runs before the route body -- a dummy UUID still proves
  // the authorization gate (player 401/403; admin/super_admin clear it
  // and reach RoundNotFoundError -> 404, never 401/403), same pattern
  // already used above for PATCH /admin/tee-configurations/:id/pcc.
  { name: "PATCH /rounds/:id/status", method: "PATCH", path: "/rounds/00000000-0000-0000-0000-000000000000/status", body: { status: "approved" } },
  { name: "DELETE /rounds/:id", method: "DELETE", path: "/rounds/00000000-0000-0000-0000-000000000000" },
  { name: "POST /players/:id/handicap-overrides", method: "POST", path: "/players/00000000-0000-0000-0000-000000000000/handicap-overrides", body: { newIndex: 10.0, reason: "RBAC matrix test" } },
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
