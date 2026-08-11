import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandicapOverridesService } from "../src/application/handicap-overrides.service.ts";
import { createLogger } from "../src/logger.ts";
import type {
  CreateHandicapOverrideInput,
  HandicapOverride,
  HandicapOverridesRepository,
} from "../src/data/handicap-overrides.repository.ts";
import type { CurrentHandicapIndex, HandicapHistoryRecord } from "../src/data/handicap-history.repository.ts";
import type { HandicapHistoryService } from "../src/application/handicap-history.service.ts";

function fakeRepository(): HandicapOverridesRepository {
  const overrides: HandicapOverride[] = [];
  let nextId = 1;
  return {
    async create(input: CreateHandicapOverrideInput) {
      const override: HandicapOverride = {
        id: String(nextId++),
        playerId: input.playerId,
        adminUserId: input.adminUserId,
        previousIndex: input.previousIndex ?? null,
        newIndex: input.newIndex,
        reason: input.reason,
        createdAt: new Date().toISOString(),
      };
      overrides.push(override);
      return override;
    },
    async listForPlayer(playerId: string) {
      return overrides.filter((o) => o.playerId === playerId);
    },
  };
}

// Records every call made to recordManualOverride -- proves ghs#21's "no
// duplicated write logic" requirement from the override side: createOverride
// must delegate to this shared function, not implement its own history write.
function fakeHandicapHistoryService(): HandicapHistoryService & { recordedCalls: unknown[][] } {
  const recordedCalls: unknown[][] = [];
  return {
    recordedCalls,
    async getCurrentIndex(): Promise<CurrentHandicapIndex | null> {
      return null;
    },
    async getCurrentIndexForUpdate(): Promise<CurrentHandicapIndex | null> {
      return null;
    },
    async listHistoryForPlayer(): Promise<HandicapHistoryRecord[]> {
      return [];
    },
    async recordCalculatedResult() {
      throw new Error("not used by these tests");
    },
    async recordManualOverride(playerId, newIndex, previousIndex, reason, createdBy, calculationDate) {
      recordedCalls.push([playerId, newIndex, previousIndex, reason, createdBy, calculationDate]);
      return { history: null, handicapIndex: newIndex, lowHandicapIndex: null };
    },
  };
}

const silentLogger = createLogger("test");

test("createOverride persists via the repository", async () => {
  const service = createHandicapOverridesService(fakeRepository(), fakeHandicapHistoryService(), silentLogger);

  const override = await service.createOverride({
    playerId: "player-1",
    adminUserId: "admin-1",
    previousIndex: 12.4,
    newIndex: 10.1,
    reason: "Correcting a data-entry error from a paper scorecard",
  });

  assert.equal(override.previousIndex, 12.4);
  assert.equal(override.newIndex, 10.1);
});

test("createOverride also records the change through the shared handicap-history write path, not a duplicated implementation", async () => {
  const history = fakeHandicapHistoryService();
  const service = createHandicapOverridesService(fakeRepository(), history, silentLogger);

  await service.createOverride({
    playerId: "player-1", adminUserId: "admin-1", previousIndex: 12.4, newIndex: 10.1, reason: "Verified correction",
  });

  assert.equal(history.recordedCalls.length, 1);
  const [playerId, newIndex, previousIndex, reason, createdBy] = history.recordedCalls[0]!;
  assert.equal(playerId, "player-1");
  assert.equal(newIndex, 10.1);
  assert.equal(previousIndex, 12.4);
  assert.equal(reason, "Verified correction");
  assert.equal(createdBy, "admin-1");
});

test("multiple overrides for the same player accumulate as history, not overwrite", async () => {
  const service = createHandicapOverridesService(fakeRepository(), fakeHandicapHistoryService(), silentLogger);

  await service.createOverride({ playerId: "player-1", adminUserId: "admin-1", newIndex: 10.1, reason: "First correction" });
  await service.createOverride({ playerId: "player-1", adminUserId: "admin-1", newIndex: 9.8, reason: "Second correction" });

  const history = await service.listOverridesForPlayer("player-1");
  assert.equal(history.length, 2);
});

test("listOverridesForPlayer only returns that player's overrides", async () => {
  const service = createHandicapOverridesService(fakeRepository(), fakeHandicapHistoryService(), silentLogger);
  await service.createOverride({ playerId: "player-1", adminUserId: "admin-1", newIndex: 10.1, reason: "A" });
  await service.createOverride({ playerId: "player-2", adminUserId: "admin-1", newIndex: 8.0, reason: "B" });

  const player1History = await service.listOverridesForPlayer("player-1");
  assert.equal(player1History.length, 1);
  assert.equal(player1History[0]!.playerId, "player-1");
});
