import type { Pool } from "pg";

export interface PasswordResetTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findValidByHash(tokenHash: string): Promise<{ id: string; userId: string } | null>;
  // Marks the given token used AND invalidates every other outstanding
  // token for the same user -- the real improvement over legacy GHS's
  // schema (IAM-020), done atomically so a reset can't race with a
  // still-valid older token.
  markUsedAndInvalidateOthers(id: string, userId: string): Promise<void>;
}

export function createPasswordResetTokenRepository(pool: Pool): PasswordResetTokenRepository {
  return {
    async create(userId, tokenHash, expiresAt) {
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [userId, tokenHash, expiresAt],
      );
    },

    async findValidByHash(tokenHash) {
      const result = await pool.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [tokenHash],
      );
      return result.rows[0] ? { id: result.rows[0].id, userId: result.rows[0].user_id } : null;
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
