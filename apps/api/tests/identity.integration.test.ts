import { test, before, after, beforeEach } from "node:test";
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
import { createAdminUsersService } from "../src/application/admin-users.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
import { generate as generateTotp } from "otplib";
import type { AuthConfig } from "../src/config.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");

const authConfig: AuthConfig = {
  jwtSecret: "test-jwt-secret-not-for-production-use",
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

  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const authService = createAuthService({
    pool,
    logger,
    authProvider,
    users,
    players,
    activationTokens,
    passwordResetTokens,
    mfa: mfaRepo,
    mfaVerifier: mfaService,
    notifications: notificationsRepository,
  });
  const adminUsersService = createAdminUsersService(pool, logger, users, players, activationTokens, notificationsRepository);

  return { users, players, activationTokens, passwordResetTokens, refreshTokens, authProvider, authService, mfaService, adminUsersService };
}

// The raw activation/reset token can't be recovered from its stored hash
// (one-way) -- ghs#39 moved delivery off a log-line placeholder onto the
// real notification_history/notification_outbox write path, so tests now
// read the token back from there directly (the same durable data the
// real worker, ghs#42, will eventually consume) rather than capturing a
// log call.
async function outboxPayloads(userId: string, eventType: string): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT o.payload FROM notification_outbox o
     JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.user_id = $1 AND h.event_type = $2
     ORDER BY o.created_at`,
    [userId, eventType],
  );
  return result.rows.map((r) => r.payload);
}

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  // Both clubs and users must be truncated explicitly, in one statement --
  // `users` has no FK relationship to `clubs`, so TRUNCATE clubs CASCADE
  // alone (ghs#7's pattern) never reaches it or anything hanging off it
  // (account_activation_tokens, refresh_tokens, user_mfa_methods, etc.).
  // Found for real: without this, users rows persisted across separate
  // test runs and produced duplicate-email failures on the second run.
  await pool.query("TRUNCATE clubs, users RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

test("full lifecycle: register -> activate -> login -> refresh", async () => {
  const s = buildServices();
  const { users, players, authProvider, authService } = s;

  const { userId } = await authService.register({ email: "jane@example.com", password: "correct-horse-battery", firstName: "Jane", lastName: "Doe" });

  // Real symmetry check (ghs#8's fix): a player profile exists even
  // though this is self-registration, same as it always did -- but the
  // real assertion here is that it's linked to the real user.
  const user = await users.findByEmail("jane@example.com");
  assert.ok(user);
  assert.equal(user!.status, "pending_verification");
  const player = await players.findByUserId(user!.id);
  assert.ok(player);
  assert.equal(player!.firstName, "Jane");

  // Login before activation must fail.
  await assert.rejects(() => authService.login("jane@example.com", "correct-horse-battery"));

  const [activationPayload] = await outboxPayloads(userId, "account_activation");
  assert.ok(activationPayload, "expected a real account_activation outbox row");
  await authService.activateAccount(activationPayload!.token as string);

  const activeUser = await users.findByEmail("jane@example.com");
  assert.equal(activeUser!.status, "active");
  assert.ok(activeUser!.emailVerifiedAt);

  const loginResult = await authService.login("jane@example.com", "correct-horse-battery");
  assert.equal(loginResult.status, "authenticated");
  if (loginResult.status !== "authenticated") throw new Error("unreachable");
  assert.ok(loginResult.tokens.accessToken);
  assert.ok(loginResult.tokens.refreshToken);

  const identity = authProvider.verifyAccessToken(loginResult.tokens.accessToken);
  assert.equal(identity.email, "jane@example.com");
  assert.equal(identity.emailVerified, true);
  assert.deepEqual(identity.amr, ["pwd"]);

  const refreshed = await authService.refresh(loginResult.tokens.refreshToken);
  assert.ok(refreshed.accessToken);

  // Reuse of the now-rotated original refresh token must fail (real
  // reuse detection, ghs#8's DB-backed reimplementation of legacy's
  // Redis-backed one).
  await assert.rejects(() => authService.refresh(loginResult.tokens.refreshToken));
});

test("password reset invalidates every other outstanding token for the user", async () => {
  const s = buildServices();
  const { authService } = s;

  const admin = await s.adminUsersService.adminCreateUser({
    email: "reset-me@example.com", password: "initial-password", role: "player",
    firstName: "Reset", lastName: "Me", autoActivate: true,
  });

  await authService.requestPasswordReset("reset-me@example.com");
  await authService.requestPasswordReset("reset-me@example.com"); // a second, newer request
  const resetPayloads = await outboxPayloads(admin.userId, "password_reset");
  assert.equal(resetPayloads.length, 2);

  const [firstToken, secondToken] = resetPayloads.map((p) => p.token as string);

  // Use the second (newer) token successfully.
  await authService.resetPassword(secondToken!, "brand-new-password");

  // The first, older, still-unused token must now be invalid too.
  await assert.rejects(() => authService.resetPassword(firstToken!, "another-password"));

  // New password actually works.
  const loginResult = await authService.login("reset-me@example.com", "brand-new-password");
  assert.equal(loginResult.status, "authenticated");
});

test("resend-activation and password-reset-request respond the same way for a non-existent email (no enumeration)", async () => {
  const s = buildServices();
  // Neither throws for an unknown address -- the route layer is what
  // actually normalises the HTTP response; this proves the service layer
  // doesn't leak existence via a thrown error either.
  await assert.doesNotReject(() => s.authService.resendActivation("nobody@example.com"));
  await assert.doesNotReject(() => s.authService.requestPasswordReset("nobody@example.com"));
});

test("admin-created account: autoActivate true skips the activation token entirely", async () => {
  const s = buildServices();
  const created = await s.adminUsersService.adminCreateUser({
    email: "auto@example.com", password: "auto-activate-pw", role: "player",
    firstName: "Auto", lastName: "Active", autoActivate: true,
  });
  const user = await s.users.findById(created.userId);
  assert.equal(user!.status, "active");
  assert.ok(user!.emailVerifiedAt);

  const loginResult = await s.authService.login("auto@example.com", "auto-activate-pw");
  assert.equal(loginResult.status, "authenticated");
});

test("admin-created account: autoActivate false requires activation, and gets a linked player profile (symmetry fix)", async () => {
  const s = buildServices();
  const { users, players, adminUsersService } = s;

  const created = await adminUsersService.adminCreateUser({
    email: "invited@example.com", password: "invited-pw-123", role: "player",
    firstName: "Invited", lastName: "Player", autoActivate: false,
  });

  const user = await users.findById(created.userId);
  assert.equal(user!.status, "pending_verification");

  const player = await players.findByUserId(created.userId);
  assert.ok(player, "admin-created player accounts must get a linked player profile too (ghs#8's symmetry fix)");

  const [invitePayload] = await outboxPayloads(created.userId, "account_activation_admin_invite");
  assert.ok(invitePayload, "expected a real account_activation_admin_invite outbox row");
});

test("MFA: enroll, confirm, login requires the second factor, backup code works once", async () => {
  const s = buildServices();
  const created = await s.adminUsersService.adminCreateUser({
    email: "mfa-user@example.com", password: "mfa-password-1", role: "player",
    firstName: "Mfa", lastName: "User", autoActivate: true,
  });

  const enrollment = await s.mfaService.enrollTotp(created.userId, "mfa-user@example.com");
  assert.ok(enrollment.otpauthUri.startsWith("otpauth://totp/"));

  const secretMatch = /secret=([A-Z0-9]+)/.exec(enrollment.otpauthUri);
  assert.ok(secretMatch);
  const secret = secretMatch![1]!;

  const validCode = await generateTotp({ secret });
  const confirmation = await s.mfaService.confirmTotpEnrollment(created.userId, validCode);
  assert.equal(confirmation.backupCodes.length, 10);

  // Login now requires the second factor.
  const loginResult = await s.authService.login("mfa-user@example.com", "mfa-password-1");
  assert.equal(loginResult.status, "mfa_required");
  if (loginResult.status !== "mfa_required") throw new Error("unreachable");

  const secondCode = await generateTotp({ secret });
  const tokens = await s.authService.completeMfaLogin(loginResult.mfaPendingToken, secondCode);
  assert.ok(tokens.accessToken);

  const identity = s.authProvider.verifyAccessToken(tokens.accessToken);
  assert.deepEqual(identity.amr, ["pwd", "otp"]);

  // A backup code works, and only once.
  const loginResult2 = await s.authService.login("mfa-user@example.com", "mfa-password-1");
  if (loginResult2.status !== "mfa_required") throw new Error("unreachable");
  const backupCode = confirmation.backupCodes[0]!;
  const tokens2 = await s.authService.completeMfaLogin(loginResult2.mfaPendingToken, backupCode);
  assert.ok(tokens2.accessToken);

  const loginResult3 = await s.authService.login("mfa-user@example.com", "mfa-password-1");
  if (loginResult3.status !== "mfa_required") throw new Error("unreachable");
  await assert.rejects(() => s.authService.completeMfaLogin(loginResult3.mfaPendingToken, backupCode));
});

test("admin can disable a user's MFA for recovery", async () => {
  const s = buildServices();
  const created = await s.adminUsersService.adminCreateUser({
    email: "recovery@example.com", password: "recovery-pw-1", role: "player",
    firstName: "Recovery", lastName: "Case", autoActivate: true,
  });
  const enrollment = await s.mfaService.enrollTotp(created.userId, "recovery@example.com");
  const secret = /secret=([A-Z0-9]+)/.exec(enrollment.otpauthUri)![1]!;
  await s.mfaService.confirmTotpEnrollment(created.userId, await generateTotp({ secret }));

  await s.mfaService.disableMfa(created.userId);

  const loginResult = await s.authService.login("recovery@example.com", "recovery-pw-1");
  assert.equal(loginResult.status, "authenticated");
});

test("admin can disable and re-enable a user account", async () => {
  const s = buildServices();
  const created = await s.adminUsersService.adminCreateUser({
    email: "toggle@example.com", password: "toggle-pw-1", role: "player",
    firstName: "Toggle", lastName: "Case", autoActivate: true,
  });

  await s.adminUsersService.setUserStatus(created.userId, "disabled");
  await assert.rejects(() => s.authService.login("toggle@example.com", "toggle-pw-1"));

  await s.adminUsersService.setUserStatus(created.userId, "active");
  const loginResult = await s.authService.login("toggle@example.com", "toggle-pw-1");
  assert.equal(loginResult.status, "authenticated");
});
