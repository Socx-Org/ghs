import type { Pool } from "pg";

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

export interface RefreshTokensRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  // Single-use: marks a refresh token rotated the moment it's exchanged.
  // A second attempt to use the same token is then rejected -- real
  // reuse/theft detection, the same real property legacy GHS's
  // Redis-backed implementation provided, reimplemented against the
  // database per the platform owner's decision (ghs#8).
  markRotated(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
}

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, rotatedAt: row.rotated_at, revokedAt: row.revoked_at };
}

export function createRefreshTokensRepository(pool: Pool): RefreshTokensRepository {
  return {
    async create(userId, tokenHash, expiresAt) {
      await pool.query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [userId, tokenHash, expiresAt],
      );
    },

    async findByHash(tokenHash) {
      const result = await pool.query<RefreshTokenRow>(
        "SELECT id, user_id, expires_at, rotated_at, revoked_at FROM refresh_tokens WHERE token_hash = $1",
        [tokenHash],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async markRotated(id) {
      await pool.query("UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1", [id]);
    },

    async revokeAllForUser(userId) {
      await pool.query(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [userId],
      );
    },
  };
}
