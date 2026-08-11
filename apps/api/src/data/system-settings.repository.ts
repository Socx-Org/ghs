import type { Pool } from "pg";

// APP-020's Configuration Management pattern: a single generic key/value
// table. This repository is deliberately generic -- it knows nothing
// about maintenance_mode, self_registration_enabled, or any other
// specific GHS setting. GHS-specific meaning, defaults, and validation
// live one layer up, in system-settings.service.ts -- not here.

export interface SettingRow {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SystemSettingsRepository {
  // Read live, at the point of use, every time -- no caching (APP-020's
  // explicit requirement). Every call is a real query.
  get(key: string): Promise<SettingRow | null>;
  upsert(key: string, value: string, description: string | null, updatedBy: string | null): Promise<SettingRow>;
  delete(key: string): Promise<void>;
  list(): Promise<SettingRow[]>;
}

interface SettingDbRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: Date;
  updated_by: string | null;
}

function toSettingRow(row: SettingDbRow): SettingRow {
  return {
    key: row.key,
    value: row.value,
    description: row.description,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

export function createSystemSettingsRepository(pool: Pool): SystemSettingsRepository {
  return {
    async get(key) {
      const result = await pool.query<SettingDbRow>(
        "SELECT key, value, description, updated_at, updated_by FROM system_settings WHERE key = $1",
        [key],
      );
      return result.rows[0] ? toSettingRow(result.rows[0]) : null;
    },

    async upsert(key, value, description, updatedBy) {
      const result = await pool.query<SettingDbRow>(
        `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               description = COALESCE(EXCLUDED.description, system_settings.description),
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
         RETURNING key, value, description, updated_at, updated_by`,
        [key, value, description, updatedBy],
      );
      return toSettingRow(result.rows[0]!);
    },

    async delete(key) {
      await pool.query("DELETE FROM system_settings WHERE key = $1", [key]);
    },

    async list() {
      const result = await pool.query<SettingDbRow>(
        "SELECT key, value, description, updated_at, updated_by FROM system_settings ORDER BY key",
      );
      return result.rows.map(toSettingRow);
    },
  };
}
