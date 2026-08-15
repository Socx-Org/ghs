import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "@ghs/api/logger";
import { runCrashRecoverySweep } from "../src/application/crash-recovery.service.ts";
import type { OutboxRepository, OutboxRow } from "../src/data/outbox.repository.ts";

// Pure unit tests against a fake (ENG-030.3) -- proves the reclaim ->
// next-state decision logic in isolation. Real Postgres coverage of
// claimStuckProcessing's own atomic UPDATE (the actual reclaim mechanism)
// lives in outbox.integration.test.ts.

const silentLogger = createLogger("test");

function fakeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "outbox-1",
    notificationHistoryId: "history-1",
    eventType: "round_submitted",
    payload: {},
    status: "processing",
    attempts: 0,
    claimedAt: new Date().toISOString(),
    retryAfter: null,
    failureReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeOutboxRepository(stuck: OutboxRow[]): OutboxRepository & {
  pendingRetries: Array<{ id: string; attempts: number; failureReason: string }>;
  failedRows: Array<{ id: string; attempts: number; failureReason: string }>;
} {
  const pendingRetries: Array<{ id: string; attempts: number; failureReason: string }> = [];
  const failedRows: Array<{ id: string; attempts: number; failureReason: string }> = [];
  return {
    pendingRetries,
    failedRows,
    async claimBatch() {
      throw new Error("not used by these tests");
    },
    async claimStuckProcessing() {
      return stuck;
    },
    async markSent() {
      throw new Error("not used by these tests");
    },
    async markPendingRetry(id, attempts, _retryAfter, failureReason) {
      pendingRetries.push({ id, attempts, failureReason });
    },
    async markFailed(id, attempts, failureReason) {
      failedRows.push({ id, attempts, failureReason });
    },
  };
}

const deps = { logger: silentLogger, timeoutMinutes: 5, batchSize: 20, backoffMinutes: [1, 5, 15] };

test("no stuck rows -- nothing happens", async () => {
  const outbox = fakeOutboxRepository([]);
  const result = await runCrashRecoverySweep({ ...deps, outbox });
  assert.deepEqual(result, { reclaimed: 0 });
});

test("a stuck row with attempts remaining is reclaimed back to pending, with attempts incremented -- a real attempt, not a free retry (ADR-210 point 7)", async () => {
  const outbox = fakeOutboxRepository([fakeRow({ attempts: 0 })]);
  const result = await runCrashRecoverySweep({ ...deps, outbox });

  assert.deepEqual(result, { reclaimed: 1 });
  assert.equal(outbox.pendingRetries.length, 1);
  assert.equal(outbox.pendingRetries[0]!.attempts, 1);
  assert.match(outbox.pendingRetries[0]!.failureReason, /crashed|terminated|reclaimed/);
  assert.equal(outbox.failedRows.length, 0);
});

test("a stuck row that has now exhausted its attempts becomes failed, not an infinite reclaim loop -- prevents a poison message looping forever", async () => {
  const outbox = fakeOutboxRepository([fakeRow({ attempts: 3 })]); // backoffMinutes has 3 entries -- this is the last reachable one
  const result = await runCrashRecoverySweep({ ...deps, outbox });

  assert.deepEqual(result, { reclaimed: 1 });
  assert.equal(outbox.pendingRetries.length, 0);
  assert.equal(outbox.failedRows.length, 1);
  assert.equal(outbox.failedRows[0]!.attempts, 4);
});

test("multiple stuck rows are each reclaimed independently", async () => {
  const outbox = fakeOutboxRepository([
    fakeRow({ id: "outbox-1", attempts: 0 }),
    fakeRow({ id: "outbox-2", attempts: 3 }), // backoffMinutes has 3 entries -- this is the last reachable one
  ]);
  const result = await runCrashRecoverySweep({ ...deps, outbox });

  assert.deepEqual(result, { reclaimed: 2 });
  assert.deepEqual(outbox.pendingRetries.map((r) => r.id), ["outbox-1"]);
  assert.deepEqual(outbox.failedRows.map((r) => r.id), ["outbox-2"]);
});
