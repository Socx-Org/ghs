import type { Pool, PoolClient } from "pg";

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
}

export interface PasswordResetTokenRepository {
  // client: when provided, the insert runs on it and no transaction is
  // opened/committed here -- the caller owns that. Added for ghs#39: the
  // token write and the real notification.record() call need to land in
  // the same transaction (ADR-210 point 1), same client-threading
  // convention already established elsewhere (activation-tokens.
  // repository.ts, rounds.repository.ts, etc.). Omitted, this method
  // issues its own single-statement insert exactly as before.
  create(userId: string, tokenHash: string, expiresAt: Date, client?: PoolClient): Promise<void>;
  // ghs#107: unrestricted lookup (same fix as activation-tokens.
  // repository.ts's findByHash, ghs#106) -- the old findValidByHash only
  // ever returned a row for a currently-valid token, which can't
  // distinguish *why* an invalid one isn't valid (expired vs already
  // used vs never existed). Found by direct comparison against #106's
  // fix, not assumed to already be different here.
  findByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  // Marks the given token used AND invalidates every other outstanding
  // token for the same user -- the real improvement over legacy GHS's
  // schema (IAM-020), done atomically so a reset can't race with a
  // still-valid older token.
  markUsedAndInvalidateOthers(id: string, userId: string): Promise<void>;
}

export function createPasswordResetTokenRepository(pool: Pool): PasswordResetTokenRepository {
  return {
    async create(userId, tokenHash, expiresAt, client) {
      await (client ?? pool).query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [userId, tokenHash, expiresAt],
      );
    },

    async findByHash(tokenHash) {
      const result = await pool.query<{ id: string; user_id: string; used_at: Date | null; expires_at: Date }>(
        `SELECT id, user_id, used_at, expires_at FROM password_reset_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row ? { id: row.id, userId: row.user_id, usedAt: row.used_at, expiresAt: row.expires_at } : null;
    },

    async markUsedAndInvalidateOthers(id, userId) {
      await pool.query(
        `UPDATE password_reset_tokens
         SET used_at = now()
         WHERE user_id = $1 AND used_at IS NULL AND (id = $2 OR expires_at > now())`,
        [userId, id],
      );
    },
  };
}
