import type { SystemSettingsRepository } from "../data/system-settings.repository.ts";

// GHS's own known settings, their defaults, and their domain validation --
// deliberately kept here, one layer above the generic APP-020 repository,
// which knows nothing about any of this (ADR-060: application-layer
// business rules, not persistence).
//
// pcc_override intentionally has no home here. It was carried forward
// from legacy in ghs#11 (platform owner decision, 2026-08-10: preserve
// its -1..3 domain invariant in application code when the database CHECK
// legacy had could no longer apply). GHS Phase 2 discovery then confirmed,
// by a full-codebase grep of legacy, that pcc_override was never actually
// consumed by legacy's real PCC/differential calculation -- dead
// configuration, not a simplified stand-in for anything real. Removed
// here rather than repurposed (ghs#19, platform owner decision,
// 2026-08-12); the per-tee-configuration-per-day mechanism in
// pcc.service.ts is the sole authoritative PCC mechanism going forward.

const KEYS = {
  maintenanceMode: "maintenance_mode",
  selfRegistrationEnabled: "self_registration_enabled",
  notifyRoundSubmitted: "notify_round_submitted",
  notifyRoundApproved: "notify_round_approved",
  notifyMaintenanceAlerts: "notify_maintenance_alerts",
} as const;

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
  getMaintenanceMode(): Promise<boolean>;
  setMaintenanceMode(value: boolean, updatedBy: string | null): Promise<void>;

  getSelfRegistrationEnabled(): Promise<boolean>;
  setSelfRegistrationEnabled(value: boolean, updatedBy: string | null): Promise<void>;

  getNotificationSettings(): Promise<NotificationSettings>;
  setNotificationSetting(setting: keyof NotificationSettings, value: boolean, updatedBy: string | null): Promise<void>;
}

export function createSystemSettingsService(repo: SystemSettingsRepository): SystemSettingsService {
  return {
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
