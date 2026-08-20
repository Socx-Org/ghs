import type { Pool, PoolClient } from "pg";

export interface ActivationTokenRecord {
  id: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
}

export interface ActivationTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date, client?: PoolClient): Promise<void>;
  // ghs#106: unrestricted lookup (unlike the old findValidByHash, which
  // only ever returned a row for a currently-valid token) -- the caller
  // needs to distinguish *why* a token isn't valid (expired vs already
  // used vs never existed), which requires seeing the row even when
  // it's no longer usable.
  findByHash(tokenHash: string): Promise<ActivationTokenRecord | null>;
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

    async findByHash(tokenHash) {
      const result = await pool.query<{ id: string; user_id: string; used_at: Date | null; expires_at: Date }>(
        `SELECT id, user_id, used_at, expires_at FROM account_activation_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row ? { id: row.id, userId: row.user_id, usedAt: row.used_at, expiresAt: row.expires_at } : null;
    },

    async markUsed(id) {
      await pool.query("UPDATE account_activation_tokens SET used_at = now() WHERE id = $1", [id]);
    },
  };
}
