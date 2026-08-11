import { test } from "node:test";
import assert from "node:assert/strict";
import { createSystemSettingsService } from "../src/application/system-settings.service.ts";
import type { SettingRow, SystemSettingsRepository } from "../src/data/system-settings.repository.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database.
function fakeRepository(): SystemSettingsRepository & { rows: Map<string, SettingRow> } {
  const rows = new Map<string, SettingRow>();
  return {
    rows,
    async get(key) {
      return rows.get(key) ?? null;
    },
    async upsert(key, value, description, updatedBy) {
      const row: SettingRow = { key, value, description, updatedAt: new Date().toISOString(), updatedBy };
      rows.set(key, row);
      return row;
    },
    async delete(key) {
      rows.delete(key);
    },
    async list() {
      return [...rows.values()];
    },
  };
}

test("pcc_override has no surviving method on SystemSettingsService -- confirmed dead legacy configuration, removed rather than repurposed (ghs#19, platform owner decision 2026-08-12)", async () => {
  const service = createSystemSettingsService(fakeRepository());
  assert.equal("getPccOverride" in service, false);
  assert.equal("setPccOverride" in service, false);
  assert.equal("clearPccOverride" in service, false);
});

test("maintenance_mode and self_registration_enabled default to false; self_registration_enabled is off-by-default matching legacy's conservative posture", async () => {
  const service = createSystemSettingsService(fakeRepository());
  assert.equal(await service.getMaintenanceMode(), false);
  assert.equal(await service.getSelfRegistrationEnabled(), false);

  await service.setMaintenanceMode(true, "admin-1");
  assert.equal(await service.getMaintenanceMode(), true);

  await service.setSelfRegistrationEnabled(true, "admin-1");
  assert.equal(await service.getSelfRegistrationEnabled(), true);
});

test("notification settings default to all-on, matching legacy's real defaults", async () => {
  const service = createSystemSettingsService(fakeRepository());
  const defaults = await service.getNotificationSettings();
  assert.deepEqual(defaults, { roundSubmitted: true, roundApproved: true, maintenanceAlerts: true });

  await service.setNotificationSetting("roundApproved", false, "admin-1");
  const updated = await service.getNotificationSettings();
  assert.deepEqual(updated, { roundSubmitted: true, roundApproved: false, maintenanceAlerts: true });
});
