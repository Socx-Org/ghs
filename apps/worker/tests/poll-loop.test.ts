import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "@ghs/api/logger";
import type { EmailProvider } from "@ghs/api/lib/email";
import type { SystemSettingsService } from "@ghs/api/application/system-settings.service";
import type { UsersRepository } from "@ghs/api/data/users.repository";
import type { PresenceSnapshotsRepository } from "@ghs/api/data/presence-snapshots.repository";
import { startPollLoop, type PollLoopDeps } from "../src/application/poll-loop.ts";
import type { OutboxRepository } from "../src/data/outbox.repository.ts";
import type { RecipientsRepository } from "../src/data/recipients.repository.ts";
import type { RetentionRepository } from "../src/data/retention.repository.ts";

// Pure unit tests against fakes (ENG-030.3) -- no DB, no network. Both
// tests here target the two bugs found in PR #47 review: a failing
// settings read must not crash the loop, and stop() must not wait out an
// arbitrary sleep interval.

const silentLogger = createLogger("test");

function emptyOutboxRepository(): OutboxRepository {
  return {
    async claimBatch() { return []; },
    async claimStuckProcessing() { return []; },
    async markSent() { /* not reached -- claimBatch never returns rows */ },
    async markPendingRetry() { /* not reached */ },
    async markFailed() { /* not reached */ },
  };
}

function emptyRecipientsRepository(): RecipientsRepository {
  return { async resolveForHistoryIds() { return new Map(); } };
}

function noopRetentionRepository(): RetentionRepository {
  return {
    async deleteRetiredSentOutbox() { return 0; },
    async deleteRetiredFailedOutbox() { return 0; },
    async deleteRetiredHistory() { return 0; },
  };
}

function noopProvider(): EmailProvider {
  return { async send() { return {}; } };
}

function fakeSystemSettings(getPollIntervalSeconds: () => number): SystemSettingsService {
  return {
    async getMaintenanceMode() { throw new Error("not used by these tests"); },
    async setMaintenanceMode() { throw new Error("not used by these tests"); },
    async getSelfRegistrationEnabled() { throw new Error("not used by these tests"); },
    async setSelfRegistrationEnabled() { throw new Error("not used by these tests"); },
    async getNotificationSettings() { throw new Error("not used by these tests"); },
    async setNotificationSetting() { throw new Error("not used by these tests"); },
    async getNotificationPollIntervalSeconds() { return getPollIntervalSeconds(); },
    async setNotificationPollIntervalSeconds() { throw new Error("not used by these tests"); },
    async getActiveUsersChartPeriod() { throw new Error("not used by these tests"); },
    async setActiveUsersChartPeriod() { throw new Error("not used by these tests"); },
  };
}

// ghs#195: presenceSnapshot's own no-op fakes -- these poll-loop tests
// are about scheduling/interrupt behaviour, not about presence snapshots
// specifically. lastPresenceSnapshotAt starts at 0 (same as
// lastRetentionAt above), so runPresenceSnapshot DOES fire on the very
// first cycle regardless of presenceSnapshotIntervalMs -- the long
// interval below only prevents a SECOND firing within these tests' own
// short lifetime, matching noopRetentionRepository's own harmless-no-op
// framing rather than claiming these methods are never called at all.
function noopUsersRepository(): UsersRepository {
  return { async countActiveNow() { return 0; } } as UsersRepository;
}

function noopPresenceSnapshotsRepository(): PresenceSnapshotsRepository {
  return {
    async insertSnapshot() { /* called once, on cycle 1 -- a harmless no-op */ },
    async getSeries() { throw new Error("not used by these tests"); },
    async hasAnySnapshot() { throw new Error("not used by these tests"); },
  };
}

function baseDeps(systemSettings: SystemSettingsService): PollLoopDeps {
  return {
    logger: silentLogger,
    systemSettings,
    delivery: {
      outbox: emptyOutboxRepository(),
      recipients: emptyRecipientsRepository(),
      provider: noopProvider(),
      logger: silentLogger,
      appBaseUrl: "https://ghs.test",
      batchSize: 20,
      backoffMinutes: [1, 5, 15],
    },
    crashRecovery: { outbox: emptyOutboxRepository(), logger: silentLogger, timeoutMinutes: 5, batchSize: 20, backoffMinutes: [1, 5, 15] },
    retention: { retention: noopRetentionRepository(), logger: silentLogger, sentRetentionDays: 7, failedRetentionDays: 30, historyRetentionDays: 365, deleteBatchSize: 1000 },
    retentionIntervalMs: 60 * 60 * 1000,
    presenceSnapshot: { users: noopUsersRepository(), presenceSnapshots: noopPresenceSnapshotsRepository() },
    presenceSnapshotIntervalMs: 60 * 60 * 1000,
  };
}

test("a transient failure reading the poll interval does not crash the loop (PR #47 review fix)", async () => {
  const systemSettings = fakeSystemSettings(() => {
    throw new Error("simulated transient DB failure reading notify_poll_interval_seconds");
  });
  const handle = startPollLoop(baseDeps(systemSettings));

  // Let the first (empty, fast) cycle run and hit the failing settings
  // read. Before this fix, that read was awaited outside runCycle()'s own
  // try/catch, so it rejected the loop's promise -- stop() (which awaits
  // that same promise) would then reject too, instead of resolving.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const stoppedAt = Date.now();
  await handle.stop();
  assert.ok(Date.now() - stoppedAt < 1000, "stop() resolved -- the loop survived the failing settings read rather than crashing");
});

test("stop() interrupts an in-progress sleep promptly, rather than waiting out the full poll interval (PR #47 review fix)", async () => {
  // A full hour -- if stop() didn't actually interrupt the sleep, this
  // test would hang until the real timer test-runner timeout, making the
  // regression unmistakable rather than silently slow.
  const systemSettings = fakeSystemSettings(() => 3600);
  const handle = startPollLoop(baseDeps(systemSettings));

  // Let the first (empty, fast) cycle finish and enter its hour-long sleep.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const stoppedAt = Date.now();
  await handle.stop();
  assert.ok(Date.now() - stoppedAt < 1000, "stop() did not wait out the full 1-hour interval");
});

test("stop() called while a cycle is actively running (not sleeping) still waits for that cycle to finish, per its own docstring", async () => {
  let resolveCycle: (() => void) | undefined;
  const slowOutbox: OutboxRepository = {
    ...emptyOutboxRepository(),
    async claimBatch() {
      await new Promise<void>((resolve) => { resolveCycle = resolve; });
      return [];
    },
  };
  const deps = baseDeps(fakeSystemSettings(() => 10));
  deps.delivery.outbox = slowOutbox;

  const handle = startPollLoop(deps);
  await new Promise((resolve) => setTimeout(resolve, 10)); // let the loop enter the slow claimBatch call

  let stopped = false;
  const stopPromise = handle.stop().then(() => { stopped = true; });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stopped, false, "stop() has not resolved yet -- the in-flight cycle is still running");

  resolveCycle?.();
  await stopPromise;
  assert.equal(stopped, true);
});
