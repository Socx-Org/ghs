import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandicapHistoryService, InvalidHandicapChangeError } from "../src/application/handicap-history.service.ts";
import type {
  HandicapHistoryRecord,
  HandicapHistoryRepository,
  RecordHandicapChangeInput,
} from "../src/data/handicap-history.repository.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database. Proves the
// shared write function is genuinely shared: both callers below route
// through the same fakeRepository().recordChange(), and the fake records
// every call it received so the test can assert on the *input shape*,
// not just the output.
function fakeRepository(): HandicapHistoryRepository & { calls: RecordHandicapChangeInput[] } {
  const calls: RecordHandicapChangeInput[] = [];
  let nextId = 1;
  return {
    calls,
    async getCurrentIndex() {
      return null;
    },
    async listForPlayer() {
      return [];
    },
    async recordChange(input) {
      calls.push(input);
      const record: HandicapHistoryRecord = {
        id: String(nextId++),
        playerId: input.playerId,
        method: input.method,
        handicapIndex: input.newIndex,
        previousIndex: input.previousIndex,
        reason: input.reason,
        createdBy: input.createdBy,
        calculationSnapshot: input.calculationSnapshot,
        calculationDate: input.calculationDate,
        createdAt: new Date().toISOString(),
      };
      return { history: record, handicapIndex: input.newIndex, lowHandicapIndex: input.newIndex };
    },
  };
}

test("recordCalculatedResult delegates to the shared recordChange with method='calculated' and no reason/createdBy", async () => {
  const repo = fakeRepository();
  const service = createHandicapHistoryService(repo);

  const result = await service.recordCalculatedResult("player-1", 14.2, "2026-05-01T00:00:00.000Z", { differentialsUsed: [10, 12] });

  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0]!.method, "calculated");
  assert.equal(repo.calls[0]!.reason, null);
  assert.equal(repo.calls[0]!.createdBy, null);
  assert.deepEqual(repo.calls[0]!.calculationSnapshot, { differentialsUsed: [10, 12] });
  assert.equal(result.history!.method, "calculated");
});

test("recordManualOverride delegates to the same shared recordChange with method='manual_override' and a reason/createdBy", async () => {
  const repo = fakeRepository();
  const service = createHandicapHistoryService(repo);

  const result = await service.recordManualOverride("player-1", 10.1, 12.4, "Verified correction", "admin-1");

  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0]!.method, "manual_override");
  assert.equal(repo.calls[0]!.reason, "Verified correction");
  assert.equal(repo.calls[0]!.createdBy, "admin-1");
  assert.equal(repo.calls[0]!.calculationSnapshot, null);
  assert.equal(result.history!.method, "manual_override");
});

test("recordManualOverride rejects an empty reason before it ever reaches the repository", async () => {
  const repo = fakeRepository();
  const service = createHandicapHistoryService(repo);

  await assert.rejects(() => service.recordManualOverride("player-1", 10.1, null, "   ", "admin-1"), InvalidHandicapChangeError);
  assert.equal(repo.calls.length, 0);
});

test("both callers produce a correctly-shaped record through the one shared function -- same repository call, different method", async () => {
  const repo = fakeRepository();
  const service = createHandicapHistoryService(repo);

  await service.recordCalculatedResult("player-1", 14.2, "2026-05-01T00:00:00.000Z", {});
  await service.recordManualOverride("player-1", 10.1, 14.2, "Admin correction", "admin-1");

  assert.equal(repo.calls.length, 2);
  assert.deepEqual(repo.calls.map((c) => c.method), ["calculated", "manual_override"]);
});
