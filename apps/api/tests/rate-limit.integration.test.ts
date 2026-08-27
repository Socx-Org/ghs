import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createSystemSettingsRepository } from "../src/data/system-settings.repository.ts";
import { createSystemSettingsService } from "../src/application/system-settings.service.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
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
import type { AppDeps } from "../src/interface/http/app.ts";
import type { AuthConfig } from "../src/config.ts";

// ghs#49 (Phase 5 -- Security Hardening). Real request-flood proof, per
// this issue's own explicit requirement -- code inspection or a unit
// test against a mocked limiter is not sufficient. Every test here
// starts a real Express server (app.listen(0)) and fires real HTTP
// requests at it via fetch(), exactly like this codebase's other real
// HTTP-level tests (e.g. system-settings.integration.test.ts's own
// self-registration-gate test).

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

// Builds the real app through the real composition root (app.ts),
// exactly like production -- rateLimitOverrides is the one test-only
// hook app.ts exposes, specifically so these tests don't need hundreds
// of real requests to prove a production-sized 300/20/10/3 threshold.
function buildApp(rateLimitOverrides?: AppDeps["rateLimitOverrides"]) {
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
    jwtSecret: "rate-limit-test-secret",
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

  return createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator,
    playersRepository: players, authProvider, rateLimitOverrides,
  });
}

async function withServer<T>(app: ReturnType<typeof buildApp>, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("general API tier: requests under the threshold succeed, the request that crosses it gets a real 429", async () => {
  const app = buildApp({ general: { limit: 5, windowMs: 60_000 } });
  await withServer(app, async (baseUrl) => {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/v1/clubs`);
      assert.equal(res.status, 200, `request ${i + 1} of 5 (within the limit) should succeed`);
    }
    const rejected = await fetch(`${baseUrl}/api/v1/clubs`);
    assert.equal(rejected.status, 429, "the 6th request, past the limit of 5, must be rejected");
    const body = await rejected.json();
    assert.match(body.error, /too many requests/);
  });
});

test("/healthz is never subject to the general API tier, even after it's exhausted", async () => {
  const app = buildApp({ general: { limit: 2, windowMs: 60_000 } });
  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/api/v1/clubs`);
    await fetch(`${baseUrl}/api/v1/clubs`);
    const exhausted = await fetch(`${baseUrl}/api/v1/clubs`);
    assert.equal(exhausted.status, 429, "the general tier is genuinely exhausted at this point");

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200, "/healthz must still succeed -- an infrastructure liveness probe must never be inadvertently throttled");

    // healthRouter only registers GET /healthz -- a GET here would be
    // exempt purely from mount order (it's handled and responded to
    // before the request ever reaches the limiter), which wouldn't
    // actually prove anything beyond that ordering. POST /healthz
    // matches no router's route at all, so if it were reachable it
    // would fall through to whatever's mounted next. ghs#57: that's no
    // longer this limiter -- /healthz is mounted directly on app,
    // entirely outside v1Router, so a request to it never reaches
    // /api/v1 at all. POST /healthz therefore 404s (no route matches),
    // never 429 -- proving mount-point separation itself is the
    // guarantee now, not a `skip` predicate (removed in ghs#57; a path
    // comparison against "/healthz" could never match from inside
    // v1Router, where req.path is already relative to /api/v1).
    const postHealth = await fetch(`${baseUrl}/healthz`, { method: "POST" });
    // Asserts the exact 404, not just "not 429" (review comment, PR #70)
    // -- notEqual alone would also pass for a 500 or any other
    // unexpected status, which wouldn't actually prove mount-point
    // separation is what's happening here.
    assert.equal(postHealth.status, 404, "POST /healthz must 404 (no route matches it), never reach v1Router's rate limiter at all");
  });
});

test("general API tier: per-IP isolation -- one IP's exhausted budget does not affect a different IP", async () => {
  const app = buildApp({ general: { limit: 3, windowMs: 60_000 } });
  await withServer(app, async (baseUrl) => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/v1/clubs`, { headers: { "X-Forwarded-For": "10.0.0.1" } });
      assert.equal(res.status, 200);
    }
    const exhaustedForA = await fetch(`${baseUrl}/api/v1/clubs`, { headers: { "X-Forwarded-For": "10.0.0.1" } });
    assert.equal(exhaustedForA.status, 429, "10.0.0.1's budget is now genuinely exhausted");

    const stillOkForB = await fetch(`${baseUrl}/api/v1/clubs`, { headers: { "X-Forwarded-For": "10.0.0.2" } });
    assert.equal(stillOkForB.status, 200, "a different IP is not cross-throttled by 10.0.0.1 exhausting its own budget");
  });
});

test("auth tier: requests under the threshold reach the route (401 for bad credentials), the request that crosses it gets 429 -- and this does not exhaust the separately-tracked general tier", async () => {
  const app = buildApp({
    general: { limit: 100, windowMs: 60_000 }, // deliberately generous -- this test proves the AUTH tier specifically
    auth: { limit: 3, windowMs: 60_000 },
  });
  await withServer(app, async (baseUrl) => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com", password: "wrong" }),
      });
      // The auth limiter counts every request regardless of the route's
      // own response status -- a real login attempt against a
      // nonexistent user genuinely returns 401 from auth.service.ts, not
      // a rate-limit rejection, for these first 3.
      assert.equal(res.status, 401, `login attempt ${i + 1} of 3 (within the auth-tier limit) should reach the route`);
    }
    const rejected = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong" }),
    });
    assert.equal(rejected.status, 429, "the 4th login attempt, past the auth-tier limit of 3, must be rejected before ever reaching the route");

    // Independent tiers: the auth tier tripped, but the much larger
    // general tier (limit: 100) has only seen 4 requests total -- a
    // non-auth route must still succeed, proving the two counters are
    // genuinely separate, not one shared budget.
    const clubs = await fetch(`${baseUrl}/api/v1/clubs`);
    assert.equal(clubs.status, 200, "the general tier's own separate budget was not exhausted by auth-tier-counted requests");
  });
});

test("sensitive-action tier: the email-keyed limiter rejects repeated requests for the SAME target email, independent of the IP-keyed limiter", async () => {
  const app = buildApp({
    sensitiveIp: { limit: 100, windowMs: 60_000 }, // deliberately generous -- isolates the email-keyed limiter specifically
    sensitiveEmail: { limit: 3, windowMs: 60_000 },
  });
  await withServer(app, async (baseUrl) => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/resend-activation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "victim@example.com" }),
      });
      assert.equal(res.status, 200, `resend ${i + 1} of 3 for the same email (within the email-tier limit) should reach the route`);
    }
    const rejected = await fetch(`${baseUrl}/api/v1/auth/resend-activation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "victim@example.com" }),
    });
    assert.equal(rejected.status, 429, "the 4th resend request for the same target email must be rejected");
    const body = await rejected.json();
    assert.match(body.error, /too many requests/);
  });
});

test("sensitive-action tier: the email-keyed limiter does not block a DIFFERENT target email even after one email's budget is exhausted", async () => {
  const app = buildApp({
    sensitiveIp: { limit: 100, windowMs: 60_000 },
    sensitiveEmail: { limit: 3, windowMs: 60_000 },
  });
  await withServer(app, async (baseUrl) => {
    for (let i = 0; i < 4; i++) {
      await fetch(`${baseUrl}/api/v1/auth/resend-activation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "victim@example.com" }),
      });
    }
    const differentEmail = await fetch(`${baseUrl}/api/v1/auth/resend-activation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone-else@example.com" }),
    });
    assert.equal(differentEmail.status, 200, "a different target email is not cross-throttled by victim@example.com's exhausted budget");
  });
});

test("sensitive-action tier: the IP-keyed limiter rejects repeated requests from the SAME source IP even when a DIFFERENT target email is used each time", async () => {
  const app = buildApp({
    sensitiveIp: { limit: 3, windowMs: 60_000 },
    sensitiveEmail: { limit: 100, windowMs: 60_000 }, // deliberately generous -- isolates the IP-keyed limiter specifically
  });
  await withServer(app, async (baseUrl) => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `target-${i}@example.com` }),
      });
      assert.equal(res.status, 200, `request ${i + 1} of 3 from the same IP (within the IP-tier limit) should reach the route`);
    }
    const rejected = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "target-3@example.com" }),
    });
    assert.equal(rejected.status, 429, "the 4th request from the same source IP must be rejected, even though every target email so far has been different -- this proves the IP layer, not just the email layer, is real protection");
  });
});

test("sensitive-action tier's combined budget is shared across resend-activation and password-reset/request, not one budget per route -- an attacker can't double it by splitting requests between the two actions", async () => {
  const app = buildApp({
    sensitiveIp: { limit: 100, windowMs: 60_000 },
    sensitiveEmail: { limit: 3, windowMs: 60_000 },
  });
  await withServer(app, async (baseUrl) => {
    const email = "shared-budget@example.com";
    await fetch(`${baseUrl}/api/v1/auth/resend-activation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    await fetch(`${baseUrl}/api/v1/auth/resend-activation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });

    const rejected = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    assert.equal(rejected.status, 429, "the 4th request for this email, split across both routes, must still be rejected -- the two routes share one combined email-keyed budget");
  });
});
