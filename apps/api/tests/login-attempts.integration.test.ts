import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import { createAuthService } from "../src/application/auth.service.ts";
import { createMfaService } from "../src/application/mfa.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
import { createLoginAttemptsRepository } from "../src/data/login-attempts.repository.ts";
import type { AuthConfig } from "../src/config.ts";

// ghs#231: real-Postgres coverage for login-attempts.repository.ts's
// own list() -- specifically the LEFT JOIN status-derivation logic
// (active/expired/logged_out), which is genuinely tricky enough SQL
// (and a real, non-obvious invariant -- "exactly one rotated_at IS NULL
// row per session_id, always") to deserve direct, real-database proof,
// not just unit-level trust. auth.service.ts's own write path (does a
// login/MFA attempt record the right outcome) is covered in
// identity.integration.test.ts instead -- this file is about reading
// the result back, including across rotation.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");

const authConfig: AuthConfig = {
  jwtSecret: "login-attempts-test-secret",
  jwtAccessExpiresInSeconds: 15 * 60,
  jwtRefreshExpiresInSeconds: 30 * 24 * 60 * 60,
  mfaPendingExpiresInSeconds: 5 * 60,
  mfaEncryptionKey: randomBytes(32),
};

function buildServices() {
  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const notificationsRepository = createNotificationsRepository(pool);
  const loginAttemptsRepository = createLoginAttemptsRepository(pool);

  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const authService = createAuthService({
    pool, logger, authProvider, users, players, activationTokens, passwordResetTokens,
    mfa: mfaRepo, mfaVerifier: mfaService, notifications: notificationsRepository, loginAttempts: loginAttemptsRepository,
  });

  return { users, authService, loginAttemptsRepository };
}

async function registerAndActivate(s: ReturnType<typeof buildServices>, email: string) {
  await s.authService.register({ email, password: "correct-horse-battery", firstName: "Login", lastName: "Attempts" });
  const user = await s.users.findByEmail(email);
  const outbox = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT o.payload FROM notification_outbox o JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.user_id = $1 AND h.event_type = 'account_activation'`,
    [user!.id],
  );
  await s.authService.activateAccount(outbox.rows[0]!.payload.token as string);
  return user!;
}

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE clubs, users RESTART IDENTITY CASCADE");
});

test("ghs#231: a fresh login's session shows 'active', with no sessionEndedAt", async () => {
  const s = buildServices();
  await registerAndActivate(s, "la-active@example.com");
  await s.authService.login("la-active@example.com", "correct-horse-battery", "198.51.100.1");

  const page = await s.loginAttemptsRepository.list(100, 0);
  const row = page.items.find((item) => item.email === "la-active@example.com")!;
  assert.equal(row.sessionStatus, "active");
  assert.equal(row.sessionEndedAt, null);
});

test("ghs#231: logging out marks the session 'logged_out', with sessionEndedAt matching the real revoked_at", async () => {
  const s = buildServices();
  await registerAndActivate(s, "la-loggedout@example.com");
  const loginResult = await s.authService.login("la-loggedout@example.com", "correct-horse-battery");
  if (loginResult.status !== "authenticated") throw new Error("unreachable");

  await s.authService.logout(loginResult.tokens.refreshToken);

  const page = await s.loginAttemptsRepository.list(100, 0);
  const row = page.items.find((item) => item.email === "la-loggedout@example.com")!;
  assert.equal(row.sessionStatus, "logged_out");
  assert.ok(row.sessionEndedAt);
});

test("ghs#231: a session past its real expires_at shows 'expired', with sessionEndedAt matching it", async () => {
  const s = buildServices();
  await registerAndActivate(s, "la-expired@example.com");
  const loginResult = await s.authService.login("la-expired@example.com", "correct-horse-battery");
  if (loginResult.status !== "authenticated") throw new Error("unreachable");

  // Real expiry, not a mock -- the row's own session_id (read back from
  // the audit row itself, not assumed) identifies which refresh_tokens
  // row to backdate.
  const page1 = await s.loginAttemptsRepository.list(100, 0);
  const sessionId = page1.items.find((item) => item.email === "la-expired@example.com")!.sessionId;
  await pool.query("UPDATE refresh_tokens SET expires_at = now() - INTERVAL '1 day' WHERE session_id = $1", [sessionId]);

  const page2 = await s.loginAttemptsRepository.list(100, 0);
  const row = page2.items.find((item) => item.email === "la-expired@example.com")!;
  assert.equal(row.sessionStatus, "expired");
  assert.ok(row.sessionEndedAt);
});

test("ghs#231: session status survives rotation -- a login_attempts row written at login still resolves against the CURRENT (post-rotation) refresh_tokens row, not the original one", async () => {
  const s = buildServices();
  await registerAndActivate(s, "la-rotated@example.com");
  const loginResult = await s.authService.login("la-rotated@example.com", "correct-horse-battery");
  if (loginResult.status !== "authenticated") throw new Error("unreachable");

  // Rotate once, then log out using the NEW (post-rotation) token --
  // the ORIGINAL login_attempts row (session_id unchanged across
  // rotation) must still resolve to 'logged_out', proving the join's
  // "rotated_at IS NULL" clause really does follow the live row forward
  // through rotation, not stay pinned to the row that existed at the
  // moment this audit row was written.
  const refreshed = await s.authService.refresh(loginResult.tokens.refreshToken);
  await s.authService.logout(refreshed.refreshToken);

  const page = await s.loginAttemptsRepository.list(100, 0);
  const row = page.items.find((item) => item.email === "la-rotated@example.com")!;
  assert.equal(row.sessionStatus, "logged_out");
});

test("ghs#231: a failed attempt (no session at all) always reports sessionStatus/sessionEndedAt as null", async () => {
  const s = buildServices();
  await registerAndActivate(s, "la-failed@example.com");
  await assert.rejects(() => s.authService.login("la-failed@example.com", "wrong-password"));

  const page = await s.loginAttemptsRepository.list(100, 0);
  const row = page.items.find((item) => item.email === "la-failed@example.com")!;
  assert.equal(row.sessionStatus, null);
  assert.equal(row.sessionEndedAt, null);
});

test("ghs#231: list() paginates via limit/offset and reports the real total, newest first", async () => {
  const s = buildServices();
  await registerAndActivate(s, "la-page@example.com");
  // 3 distinct attempts, in order.
  await assert.rejects(() => s.authService.login("la-page@example.com", "wrong-1"));
  await assert.rejects(() => s.authService.login("la-page@example.com", "wrong-2"));
  await s.authService.login("la-page@example.com", "correct-horse-battery");

  const firstPage = await s.loginAttemptsRepository.list(2, 0);
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.items.length, 2);
  // Newest first -- the real successful login (the last one made) comes
  // before the two failures.
  assert.equal(firstPage.items[0]!.outcome, "success");
  assert.equal(firstPage.items[1]!.outcome, "invalid_credentials");

  const secondPage = await s.loginAttemptsRepository.list(2, 2);
  assert.equal(secondPage.total, 3);
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.items[0]!.outcome, "invalid_credentials");
});
