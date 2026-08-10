import type { Pool, PoolClient } from "pg";

export interface ActivationTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date, client?: PoolClient): Promise<void>;
  findValidByHash(tokenHash: string): Promise<{ id: string; userId: string } | null>;
  markUsed(id: string): Promise<void>;
}

export function createActivationTokenRepository(pool: Pool): ActivationTokenRepository {
  return {
    async create(userId, tokenHash, expiresAt, client) {
      const runner = client ?? pool;
      await runner.query(
        "INSERT INTO account_activation_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [userId, tokenHash, expiresAt],
      );
    },

    async findValidByHash(tokenHash) {
      const result = await pool.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM account_activation_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [tokenHash],
      );
      return result.rows[0] ? { id: result.rows[0].id, userId: result.rows[0].user_id } : null;
    },

    async markUsed(id) {
      await pool.query("UPDATE account_activation_tokens SET used_at = now() WHERE id = $1", [id]);
    },
  };
}
