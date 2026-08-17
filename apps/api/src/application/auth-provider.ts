import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import type { AuthConfig } from "../config.ts";
import type { RefreshTokensRepository } from "../data/refresh-tokens.repository.ts";
import type { User } from "../data/users.repository.ts";

// IAM-020's AuthProvider abstraction. Today: LocalAuthProvider, password +
// argon2 + JWT against GHS's own `users` table. Once ADR-120's shared
// identity provider exists: a second implementation drops in behind the
// same Identity/AuthProvider shape -- nothing above this layer changes.
//
// Claims are shaped like OIDC ID-token claims now (sub/email/
// email_verified/amr), specifically so that swap is a smaller remap
// later, not a redesign.

export interface Identity {
  sub: string;
  email: string;
  emailVerified: boolean;
  amr: string[];
  ghsRole: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthProvider {
  issueTokens(user: User, amr: string[]): Promise<TokenPair>;
  verifyAccessToken(token: string): Identity;
  // Validates and single-uses a refresh token, returning the userId it
  // belonged to. Does not itself issue a new token pair -- the caller
  // (auth.service) re-fetches the current user record (role/status may
  // have changed since the refresh token was issued) and calls
  // issueTokens with it. Splitting it this way avoids the alternative of
  // this function needing a "fetch user by id" dependency of its own.
  validateAndRotateRefreshToken(refreshToken: string): Promise<string>;
  issueMfaPendingToken(userId: string): string;
  verifyMfaPendingToken(token: string): string;
}

interface AccessTokenClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  amr: string[];
  ghs_role: string;
  tokenType: "access";
}

interface MfaPendingClaims {
  sub: string;
  tokenType: "mfa_pending";
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ghs#53: pinned explicitly on both sign and verify, rather than left to
// jsonwebtoken's own default -- an auditable allow-list stated in one
// place, not inferred from library behaviour.
const JWT_ALGORITHM = "HS256";

export function createLocalAuthProvider(config: AuthConfig, refreshTokens: RefreshTokensRepository): AuthProvider {
  async function issueTokens(user: User, amr: string[]): Promise<TokenPair> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      email: user.email,
      email_verified: user.emailVerifiedAt !== null,
      amr,
      ghs_role: user.role,
      tokenType: "access",
    };
    const accessToken = jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtAccessExpiresInSeconds, algorithm: JWT_ALGORITHM });

    const rawRefreshToken = randomBytes(32).toString("hex");
    const refreshTokenHash = hashRefreshToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + config.jwtRefreshExpiresInSeconds * 1000);
    await refreshTokens.create(user.id, refreshTokenHash, expiresAt);

    return { accessToken, refreshToken: rawRefreshToken, expiresIn: config.jwtAccessExpiresInSeconds };
  }

  return {
    issueTokens,

    verifyAccessToken(token) {
      const claims = jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] }) as AccessTokenClaims;
      if (claims.tokenType !== "access") {
        throw new Error("not an access token");
      }
      return {
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified,
        amr: claims.amr,
        ghsRole: claims.ghs_role,
      };
    },

    async validateAndRotateRefreshToken(refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const record = await refreshTokens.findByHash(tokenHash);
      if (!record) throw new Error("invalid refresh token");
      if (record.revokedAt) throw new Error("refresh token revoked");
      if (record.rotatedAt) {
        // Reuse of an already-rotated token -- the real signal legacy
        // GHS's Redis-backed reuse detection existed to catch, kept here
        // against the database instead (ghs#8).
        await refreshTokens.revokeAllForUser(record.userId);
        throw new Error("refresh token reuse detected -- all sessions revoked");
      }
      if (record.expiresAt.getTime() < Date.now()) throw new Error("refresh token expired");

      await refreshTokens.markRotated(record.id);
      return record.userId;
    },

    issueMfaPendingToken(userId) {
      const claims: MfaPendingClaims = { sub: userId, tokenType: "mfa_pending" };
      return jwt.sign(claims, config.jwtSecret, { expiresIn: config.mfaPendingExpiresInSeconds, algorithm: JWT_ALGORITHM });
    },

    verifyMfaPendingToken(token) {
      const claims = jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] }) as MfaPendingClaims;
      if (claims.tokenType !== "mfa_pending") {
        throw new Error("not an MFA-pending token");
      }
      return claims.sub;
    },
  };
}
