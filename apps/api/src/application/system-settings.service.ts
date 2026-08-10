import type { SystemSettingsRepository } from "../data/system-settings.repository.ts";

// GHS's own known settings, their defaults, and their domain validation --
// deliberately kept here, one layer above the generic APP-020 repository,
// which knows nothing about any of this (ADR-060: application-layer
// business rules, not persistence).
//
// Platform owner decision, 2026-08-10: moving system_settings to APP-020's
// generic key/value shape (over legacy's fixed-column singleton with a
// database CHECK) must not mean removing the pcc_override -1..3 domain
// invariant -- it is enforced here, at every write path, not dropped.

const KEYS = {
  pccOverride: "pcc_override",
  maintenanceMode: "maintenance_mode",
  selfRegistrationEnabled: "self_registration_enabled",
  notifyRoundSubmitted: "notify_round_submitted",
  notifyRoundApproved: "notify_round_approved",
  notifyMaintenanceAlerts: "notify_maintenance_alerts",
} as const;

const PCC_OVERRIDE_MIN = -1;
const PCC_OVERRIDE_MAX = 3;

export class InvalidSettingValueError extends Error {}

function parseBoolean(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new InvalidSettingValueError(`expected "true" or "false", got ${JSON.stringify(raw)}`);
}

export interface NotificationSettings {
  roundSubmitted: boolean;
  roundApproved: boolean;
  maintenanceAlerts: boolean;
}

export interface SystemSettingsService {
  getPccOverride(): Promise<number | null>;
  // Domain invariant enforced here, not by a database CHECK (platform
  // owner decision, ghs#11) -- rejects out-of-range values before they
  // ever reach the repository.
  setPccOverride(value: number, updatedBy: string | null): Promise<void>;
  clearPccOverride(updatedBy: string | null): Promise<void>;

  getMaintenanceMode(): Promise<boolean>;
  setMaintenanceMode(value: boolean, updatedBy: string | null): Promise<void>;

  getSelfRegistrationEnabled(): Promise<boolean>;
  setSelfRegistrationEnabled(value: boolean, updatedBy: string | null): Promise<void>;

  getNotificationSettings(): Promise<NotificationSettings>;
  setNotificationSetting(setting: keyof NotificationSettings, value: boolean, updatedBy: string | null): Promise<void>;
}

export function createSystemSettingsService(repo: SystemSettingsRepository): SystemSettingsService {
  return {
    async getPccOverride() {
      const row = await repo.get(KEYS.pccOverride);
      if (!row) return null; // absence of the row IS "no override" -- no sentinel value needed
      return Number(row.value);
    },

    async setPccOverride(value, updatedBy) {
      if (!Number.isInteger(value) || value < PCC_OVERRIDE_MIN || value > PCC_OVERRIDE_MAX) {
        throw new InvalidSettingValueError(
          `pcc_override must be an integer between ${PCC_OVERRIDE_MIN} and ${PCC_OVERRIDE_MAX}, got ${value}`,
        );
      }
      await repo.upsert(
        KEYS.pccOverride,
        String(value),
        "Playing Conditions Calculation override, WHS-valid range -1..3",
        updatedBy,
      );
    },

    async clearPccOverride(updatedBy) {
      void updatedBy; // no row to attribute a deletion to; kept in the signature for symmetry/future audit use
      await repo.delete(KEYS.pccOverride);
    },

    async getMaintenanceMode() {
      const row = await repo.get(KEYS.maintenanceMode);
      return row ? parseBoolean(row.value) : false; // default: off
    },

    async setMaintenanceMode(value, updatedBy) {
      await repo.upsert(KEYS.maintenanceMode, String(value), "Maintenance mode toggle", updatedBy);
    },

    async getSelfRegistrationEnabled() {
      const row = await repo.get(KEYS.selfRegistrationEnabled);
      return row ? parseBoolean(row.value) : false; // default: off, matching legacy's conservative default
    },

    async setSelfRegistrationEnabled(value, updatedBy) {
      await repo.upsert(
        KEYS.selfRegistrationEnabled,
        String(value),
        "Whether public self-registration (POST /auth/register) is open",
        updatedBy,
      );
    },

    async getNotificationSettings() {
      const [submitted, approved, maintenance] = await Promise.all([
        repo.get(KEYS.notifyRoundSubmitted),
        repo.get(KEYS.notifyRoundApproved),
        repo.get(KEYS.notifyMaintenanceAlerts),
      ]);
      // Defaults match legacy's own real defaults (all on).
      return {
        roundSubmitted: submitted ? parseBoolean(submitted.value) : true,
        roundApproved: approved ? parseBoolean(approved.value) : true,
        maintenanceAlerts: maintenance ? parseBoolean(maintenance.value) : true,
      };
    },

    async setNotificationSetting(setting, value, updatedBy) {
      const keyMap: Record<keyof NotificationSettings, string> = {
        roundSubmitted: KEYS.notifyRoundSubmitted,
        roundApproved: KEYS.notifyRoundApproved,
        maintenanceAlerts: KEYS.notifyMaintenanceAlerts,
      };
      await repo.upsert(keyMap[setting], String(value), `Notification toggle: ${setting}`, updatedBy);
    },
  };
}
