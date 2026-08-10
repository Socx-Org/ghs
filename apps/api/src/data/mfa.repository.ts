import type { Pool } from "pg";

export interface MfaMethod {
  id: string;
  userId: string;
  method: "totp";
  encryptedSecret: string;
  enabledAt: string | null;
}

export interface MfaRepository {
  createTotpMethod(userId: string, encryptedSecret: string): Promise<MfaMethod>;
  getTotpMethod(userId: string): Promise<MfaMethod | null>;
  enableMethod(id: string): Promise<void>;
  deleteAllMethods(userId: string): Promise<void>;
  createBackupCodes(userId: string, codeHashes: string[]): Promise<void>;
  consumeBackupCode(userId: string, codeHash: string): Promise<boolean>;
}

interface MfaMethodRow {
  id: string;
  user_id: string;
  method: "totp";
  secret: string;
  enabled_at: Date | null;
}

function toMethod(row: MfaMethodRow): MfaMethod {
  return {
    id: row.id,
    userId: row.user_id,
    method: row.method,
    encryptedSecret: row.secret,
    enabledAt: row.enabled_at ? row.enabled_at.toISOString() : null,
  };
}

export function createMfaRepository(pool: Pool): MfaRepository {
  return {
    async createTotpMethod(userId, encryptedSecret) {
      const result = await pool.query<MfaMethodRow>(
        `INSERT INTO user_mfa_methods (user_id, method, secret)
         VALUES ($1, 'totp', $2)
         ON CONFLICT (user_id, method) DO UPDATE SET secret = EXCLUDED.secret, enabled_at = NULL
         RETURNING id, user_id, method, secret, enabled_at`,
        [userId, encryptedSecret],
      );
      return toMethod(result.rows[0]!);
    },

    async getTotpMethod(userId) {
      const result = await pool.query<MfaMethodRow>(
        "SELECT id, user_id, method, secret, enabled_at FROM user_mfa_methods WHERE user_id = $1 AND method = 'totp'",
        [userId],
      );
      return result.rows[0] ? toMethod(result.rows[0]) : null;
    },

    async enableMethod(id) {
      await pool.query("UPDATE user_mfa_methods SET enabled_at = now() WHERE id = $1", [id]);
    },

    async deleteAllMethods(userId) {
      await pool.query("DELETE FROM user_mfa_methods WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM user_mfa_backup_codes WHERE user_id = $1", [userId]);
    },

    async createBackupCodes(userId, codeHashes) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM user_mfa_backup_codes WHERE user_id = $1", [userId]);
        for (const codeHash of codeHashes) {
          await client.query(
            "INSERT INTO user_mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)",
            [userId, codeHash],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async consumeBackupCode(userId, codeHash) {
      const result = await pool.query(
        `UPDATE user_mfa_backup_codes
         SET used_at = now()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
         RETURNING id`,
        [userId, codeHash],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
