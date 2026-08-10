import { test } from "node:test";
import assert from "node:assert/strict";
import { createSystemSettingsService, InvalidSettingValueError } from "../src/application/system-settings.service.ts";
import type { SettingRow, SystemSettingsRepository } from "../src/data/system-settings.repository.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database. Proves the
// pcc_override domain invariant (-1..3) is enforced here, in application
// code, now that the database CHECK constraint legacy GHS had is gone
// (ghs#11, platform owner decision: APP-020's generic key/value shape
// over legacy's fixed-column singleton).
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

test("pcc_override accepts every value in the valid -1..3 range", async () => {
  const service = createSystemSettingsService(fakeRepository());
  for (const value of [-1, 0, 1, 2, 3]) {
    await service.setPccOverride(value, "admin-1");
    assert.equal(await service.getPccOverride(), value);
  }
});

test("pcc_override rejects every value outside -1..3", async () => {
  const service = createSystemSettingsService(fakeRepository());
  for (const value of [-2, 4, 10, -100]) {
    await assert.rejects(() => service.setPccOverride(value, "admin-1"), InvalidSettingValueError);
  }
});

test("pcc_override rejects non-integer values", async () => {
  const service = createSystemSettingsService(fakeRepository());
  await assert.rejects(() => service.setPccOverride(1.5, "admin-1"), InvalidSettingValueError);
});

test("pcc_override defaults to null (no override) when never set", async () => {
  const service = createSystemSettingsService(fakeRepository());
  assert.equal(await service.getPccOverride(), null);
});

test("pcc_override can be cleared back to null", async () => {
  const service = createSystemSettingsService(fakeRepository());
  await service.setPccOverride(2, "admin-1");
  assert.equal(await service.getPccOverride(), 2);
  await service.clearPccOverride("admin-1");
  assert.equal(await service.getPccOverride(), null);
});

test("an out-of-range write never reaches the repository -- rejected before any upsert", async () => {
  const repo = fakeRepository();
  const service = createSystemSettingsService(repo);
  await assert.rejects(() => service.setPccOverride(99, "admin-1"));
  assert.equal(repo.rows.size, 0);
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
