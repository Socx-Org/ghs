import type { Pool } from "pg";
import type { Logger } from "../logger.ts";
import type { AuthProvider, TokenPair } from "./auth-provider.ts";
import type { UserRole, UserStatus, UsersRepository } from "../data/users.repository.ts";
import type { PlayersRepository } from "../data/players.repository.ts";
import type { ActivationTokenRepository } from "../data/activation-tokens.repository.ts";
import type { PasswordResetTokenRepository } from "../data/password-reset-tokens.repository.ts";
import type { MfaRepository } from "../data/mfa.repository.ts";
import type { NotificationsRepository } from "../data/notifications.repository.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";
import { generateToken, hashToken } from "../lib/tokens.ts";

const ACTIVATION_TOKEN_TTL_HOURS = 24;
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

// ghs#98: distinct classes (same convention as rounds.service.ts's
// RoundNotFoundError etc.) so the route can tell these two *expected*
// change-password failures apart from anything unexpected -- a blanket
// catch that always reported "current password is incorrect" would
// have masked a real DB outage as a bad-password error, and also
// misreported a disabled/deleted/pending account's rejection as the
// same thing (review finding, PR #121).
export class IncorrectPasswordError extends Error {}
export class AccountNotActiveError extends Error {}

export type LoginResult =
  | { status: "authenticated"; tokens: TokenPair }
  | { status: "mfa_required"; mfaPendingToken: string };

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  clubId?: string;
}

// ghs#98: the account-level counterpart to GET /players/me -- works for
// every role, including admin/super_admin, which have no players row at
// all (IAM-020's strict separation). firstName/lastName are null for
// those, same reasoning as AdminUserListItem.
export interface AccountProfile {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  firstName: string | null;
  lastName: string | null;
}

// Narrow interface auth.service depends on for MFA code verification --
// implemented by mfa.service.ts, which owns the actual TOTP/backup-code
// algorithm. Kept separate from MfaRepository (used directly below only
// for the simple "is MFA enabled" existence check) so the real
// verification logic lives in exactly one place.
export interface MfaCodeVerifier {
  verifyLoginCode(userId: string, code: string): Promise<boolean>;
}

export interface AuthServiceDeps {
  pool: Pool;
  logger: Logger;
  authProvider: AuthProvider;
  users: UsersRepository;
  players: PlayersRepository;
  activationTokens: ActivationTokenRepository;
  passwordResetTokens: PasswordResetTokenRepository;
  mfa: MfaRepository;
  mfaVerifier: MfaCodeVerifier;
  notifications: NotificationsRepository;
}

export interface AuthService {
  register(input: RegisterInput): Promise<{ userId: string }>;
  login(email: string, password: string): Promise<LoginResult>;
  completeMfaLogin(mfaPendingToken: string, code: string): Promise<TokenPair>;
  refresh(refreshToken: string): Promise<TokenPair>;
  // ghs#59: real logout -- revokes exactly the presented refresh token,
  // never other active sessions belonging to the same user.
  logout(refreshToken: string): Promise<void>;
  activateAccount(rawToken: string): Promise<void>;
  resendActivation(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(rawToken: string, newPassword: string): Promise<void>;
  // ghs#98: null, not a thrown error, when the caller's own account is
  // genuinely gone -- realistically near-unreachable today (deletion is
  // a soft status change, the row itself never disappears), but this
  // still mirrors GET /players/me's own "a real, legitimate 404 case"
  // reasoning rather than assuming it can never happen.
  getMe(userId: string): Promise<AccountProfile | null>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { pool, logger, authProvider, users, players, activationTokens, passwordResetTokens, mfa, mfaVerifier, notifications } = deps;

  return {
    async register(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const passwordHash = await hashPassword(input.password);
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, role, status)
           VALUES ($1, $2, 'player', 'pending_verification')
           RETURNING id`,
          [input.email, passwordHash],
        );
        const userId = userResult.rows[0].id as string;

        // Symmetric player-profile creation (ghs#8's fix over legacy) --
        // every player-role account gets a linked profile at creation
        // time, regardless of registration path.
        await players.create(
          { userId, clubId: input.clubId, firstName: input.firstName, lastName: input.lastName },
          client,
        );

        const rawToken = generateToken();
        const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
        await activationTokens.create(userId, hashToken(rawToken), expiresAt, client);

        // ghs#39: moved inside the transaction (was previously logged
        // after COMMIT, a real gap -- a crash between commit and the log
        // call would have silently dropped the only record of the
        // activation token ever having been issued). The raw token is
        // deliberately part of the durable payload, not a log line: the
        // worker (ghs#42) needs it to build the real activation email's
        // content, and this is the outbox's own necessary message data,
        // not observability output -- SEC-010's "never log a token" rule
        // targets stdout/journald, not this table.
        await notifications.record(
          { userId, eventType: "account_activation", payload: { email: input.email, token: rawToken, expiresAt: expiresAt.toISOString() } },
          client,
        );

        await client.query("COMMIT");
        logger.info("user registered", { userId });
        return { userId };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async login(email, password) {
      const user = await users.findByEmail(email);
      if (!user) throw new Error("invalid credentials");
      if (user.status !== "active") throw new Error("account not active");

      const passwordOk = await verifyPassword(user.passwordHash, password);
      if (!passwordOk) throw new Error("invalid credentials");

      const mfaMethod = await mfa.getTotpMethod(user.id);
      if (mfaMethod && mfaMethod.enabledAt) {
        return { status: "mfa_required", mfaPendingToken: authProvider.issueMfaPendingToken(user.id) };
      }

      const tokens = await authProvider.issueTokens(user, ["pwd"]);
      return { status: "authenticated", tokens };
    },

    async completeMfaLogin(mfaPendingToken, code) {
      const userId = authProvider.verifyMfaPendingToken(mfaPendingToken);
      const user = await users.findById(userId);
      if (!user || user.status !== "active") throw new Error("account not active");

      const codeOk = await mfaVerifier.verifyLoginCode(userId, code);
      if (!codeOk) throw new Error("invalid MFA code");

      return authProvider.issueTokens(user, ["pwd", "otp"]);
    },

    async refresh(refreshToken) {
      const userId = await authProvider.validateAndRotateRefreshToken(refreshToken);
      const user = await users.findById(userId);
      if (!user || user.status !== "active") throw new Error("account not active");
      return authProvider.issueTokens(user, ["pwd"]);
    },

    async logout(refreshToken) {
      await authProvider.revokeRefreshToken(refreshToken);
    },

    async activateAccount(rawToken) {
      const record = await activationTokens.findValidByHash(hashToken(rawToken));
      if (!record) throw new Error("invalid or expired activation token");

      await users.setStatus(record.userId, "active");
      await users.markEmailVerified(record.userId);
      await activationTokens.markUsed(record.id);
    },

    async resendActivation(email) {
      const user = await users.findByEmail(email);
      // Responds the same way regardless of whether the user exists --
      // closes the user-enumeration gap legacy GHS had (409 on duplicate
      // registration). Caller (route layer) always returns 200.
      if (!user || user.status !== "pending_verification") return;

      const rawToken = generateToken();
      const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

      // ghs#39: this method previously had no transaction at all -- the
      // token write and the (placeholder) "delivery" were two
      // independent operations. Now a real transaction spans both real
      // writes (ADR-210 point 1).
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await activationTokens.create(user.id, hashToken(rawToken), expiresAt, client);
        await notifications.record(
          { userId: user.id, eventType: "account_activation_resend", payload: { email, token: rawToken, expiresAt: expiresAt.toISOString() } },
          client,
        );
        await client.query("COMMIT");
        logger.info("activation resent", { userId: user.id });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async requestPasswordReset(email) {
      const user = await users.findByEmail(email);
      if (!user) return; // same user-enumeration protection as resendActivation

      const rawToken = generateToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);

      // Same fix as resendActivation above -- no transaction existed here before.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await passwordResetTokens.create(user.id, hashToken(rawToken), expiresAt, client);
        await notifications.record(
          { userId: user.id, eventType: "password_reset", payload: { email, token: rawToken, expiresAt: expiresAt.toISOString() } },
          client,
        );
        await client.query("COMMIT");
        logger.info("password reset requested", { userId: user.id });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async resetPassword(rawToken, newPassword) {
      const record = await passwordResetTokens.findValidByHash(hashToken(rawToken));
      if (!record) throw new Error("invalid or expired reset token");

      const passwordHash = await hashPassword(newPassword);
      await users.setPasswordHash(record.userId, passwordHash);
      // Invalidates every other outstanding reset token for this user too
      // -- the real improvement over legacy's schema (ghs#8).
      await passwordResetTokens.markUsedAndInvalidateOthers(record.id, record.userId);
    },

    async getMe(userId) {
      const user = await users.findById(userId);
      if (!user) return null;
      const player = await players.findByUserId(userId);
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        firstName: player?.firstName ?? null,
        lastName: player?.lastName ?? null,
      };
    },

    async changePassword(userId, currentPassword, newPassword) {
      const user = await users.findById(userId);
      if (!user) throw new Error("account not found");
      // Same status gate as login/refresh/completeMfaLogin -- an access
      // token stays valid until its own TTL regardless of a status
      // change that happens after it was issued (no ordinary resource
      // route re-checks status per request), so without this a
      // disabled/deleted/pending account could still set new credentials
      // for as long as its existing token remains valid (review finding,
      // PR #121).
      if (user.status !== "active") throw new AccountNotActiveError("account not active");

      const currentOk = await verifyPassword(user.passwordHash, currentPassword);
      if (!currentOk) throw new IncorrectPasswordError("current password is incorrect");

      const passwordHash = await hashPassword(newPassword);
      await users.setPasswordHash(userId, passwordHash);
    },
  };
}
