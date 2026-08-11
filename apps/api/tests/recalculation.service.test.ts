import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createLogger } from "../src/logger.ts";
import type { RoundDifferentialRow, RoundsRepository } from "../src/data/rounds.repository.ts";
import type {
  CurrentHandicapIndex,
  HandicapHistoryRecord,
  RecordHandicapChangeResult,
} from "../src/data/handicap-history.repository.ts";
import type { HandicapHistoryService } from "../src/application/handicap-history.service.ts";
import type { DailyPcc } from "../src/data/pcc.repository.ts";
import type { PccService } from "../src/application/pcc.service.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database.

const silentLogger = createLogger("test");

function fakeRoundsRepository(differentialsByPlayer: Record<string, RoundDifferentialRow[]>): RoundsRepository {
  return {
    async create() { throw new Error("not used"); },
    async addHoleScore() { throw new Error("not used"); },
    async updateScores() { throw new Error("not used"); },
    async get() { return null; },
    async listByPlayer() { return []; },
    async listApprovedDifferentialsForPlayer(playerId) {
      return differentialsByPlayer[playerId] ?? [];
    },
    async setStatus() { /* not used */ },
  };
}

// A minimal fake pg.Pool -- only used for the self-managed-mode
// transaction wrapper's own BEGIN/COMMIT/ROLLBACK calls. The fake
// HandicapHistoryService/RoundsRepository below ignore whatever client
// they're given entirely (they're not real repositories), so this fake
// client is never actually queried for real data -- it only needs to
// tolerate being asked to run those three statements and to be released.
function fakePool(): Pool {
  const fakeClient = {
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => { /* no-op */ },
  } as unknown as PoolClient;
  return { connect: async () => fakeClient } as unknown as Pool;
}

function fakeHandicapHistoryService(
  currentIndexByPlayer: Record<string, CurrentHandicapIndex | null>,
  recordCalls: Array<{ playerId: string; newIndex: number; snapshot: Record<string, unknown> }>,
  options?: { throwForPlayerId?: string },
): HandicapHistoryService {
  let nextId = 1;
  return {
    async getCurrentIndex(playerId) {
      return currentIndexByPlayer[playerId] ?? null;
    },
    async getCurrentIndexForUpdate(playerId) {
      return currentIndexByPlayer[playerId] ?? null;
    },
    async listHistoryForPlayer(): Promise<HandicapHistoryRecord[]> {
      return [];
    },
    async recordCalculatedResult(playerId, newIndex, _calculationDate, snapshot): Promise<RecordHandicapChangeResult> {
      if (options?.throwForPlayerId === playerId) {
        throw new Error(`simulated failure for ${playerId}`);
      }
      recordCalls.push({ playerId, newIndex, snapshot });
      const record: HandicapHistoryRecord = {
        id: String(nextId++),
        playerId,
        method: "calculated",
        handicapIndex: newIndex,
        previousIndex: currentIndexByPlayer[playerId]?.handicapIndex ?? null,
        reason: null,
        createdBy: null,
        calculationSnapshot: snapshot,
        calculationDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      return { history: record, handicapIndex: newIndex, lowHandicapIndex: newIndex };
    },
    async recordManualOverride() {
      throw new Error("not used by these tests");
    },
  };
}

function unusedPccService(): PccService {
  return {
    async getOrCreateDailyPcc() { throw new Error("not used by these tests"); },
    async calculateOrOverride() { throw new Error("not used by these tests"); },
  };
}

function makeDifferentials(count: number, baseValue = 10): RoundDifferentialRow[] {
  return Array.from({ length: count }, (_, i) => ({
    roundId: `round-${i}`,
    playedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    scoreDifferential: baseValue + i,
    is9Hole: false,
  }));
}

test("recalculatePlayerHandicap: player_not_found when the player doesn't exist (or is soft-deleted)", async () => {
  const orchestrator = createRecalculationOrchestrator(
    fakePool(),
    fakeRoundsRepository({}),
    fakeHandicapHistoryService({}, []),
    unusedPccService(),
    silentLogger,
  );

  const result = await orchestrator.recalculatePlayerHandicap("ghost-player", "round_approved");
  assert.equal(result.status, "player_not_found");
});

test("recalculatePlayerHandicap: insufficient_holes when fewer than 3 effective differentials exist", async () => {
  const orchestrator = createRecalculationOrchestrator(
    fakePool(),
    fakeRoundsRepository({ "player-1": makeDifferentials(2) }),
    fakeHandicapHistoryService({ "player-1": { handicapIndex: null, lowHandicapIndex: null } }, []),
    unusedPccService(),
    silentLogger,
  );

  const result = await orchestrator.recalculatePlayerHandicap("player-1", "round_approved");
  assert.equal(result.status, "insufficient_holes");
});

test("recalculatePlayerHandicap: eligible writes through handicap-history's shared path and returns the applied index", async () => {
  const recordCalls: Array<{ playerId: string; newIndex: number; snapshot: Record<string, unknown> }> = [];
  const orchestrator = createRecalculationOrchestrator(
    fakePool(),
    fakeRoundsRepository({ "player-1": makeDifferentials(3, 10) }),
    fakeHandicapHistoryService({ "player-1": { handicapIndex: null, lowHandicapIndex: null } }, recordCalls),
    unusedPccService(),
    silentLogger,
  );

  const result = await orchestrator.recalculatePlayerHandicap("player-1", "round_approved");
  assert.equal(result.status, "eligible");
  assert.equal(recordCalls.length, 1);
  assert.equal(recordCalls[0]!.playerId, "player-1");
  // 3 scores -> lowest 1 (10.0), adjustment -2.0 -> (10-2)*0.96 = 7.68 -> truncated 7.6
  assert.equal(result.handicapIndex, 7.6);
  assert.ok(result.historyRecordId);
});

test("recalculatePlayerHandicap: an unchanged recalculation surfaces a null historyRecordId, not a fabricated one", async () => {
  // Simulate "no change" by having the fake history service's
  // recordCalculatedResult report a null history (mirrors ghs#21's real
  // change-only behaviour without needing a real database here).
  const orchestrator = createRecalculationOrchestrator(
    fakePool(),
    fakeRoundsRepository({ "player-1": makeDifferentials(3, 10) }),
    {
      async getCurrentIndex() {
        return { handicapIndex: 7.6, lowHandicapIndex: 7.6 };
      },
      async getCurrentIndexForUpdate() {
        return { handicapIndex: 7.6, lowHandicapIndex: 7.6 };
      },
      async listHistoryForPlayer() { return []; },
      async recordCalculatedResult(playerId: string, newIndex: number) {
        return { history: null, handicapIndex: newIndex, lowHandicapIndex: 7.6 };
      },
      async recordManualOverride() { throw new Error("not used"); },
    },
    unusedPccService(),
    silentLogger,
  );

  const result = await orchestrator.recalculatePlayerHandicap("player-1", "round_approved");
  assert.equal(result.status, "eligible");
  assert.equal(result.historyRecordId, null);
});

test("recalculatePlayerHandicap: a thrown error is caught and reported as a 'failed' outcome, not propagated", async () => {
  const orchestrator = createRecalculationOrchestrator(
    fakePool(),
    fakeRoundsRepository({ "player-1": makeDifferentials(3, 10) }),
    fakeHandicapHistoryService(
      { "player-1": { handicapIndex: null, lowHandicapIndex: null } },
      [],
      { throwForPlayerId: "player-1" },
    ),
    unusedPccService(),
    silentLogger,
  );

  const result = await orchestrator.recalculatePlayerHandicap("player-1", "round_approved");
  assert.equal(result.status, "failed");
  assert.match(result.error!, /simulated failure/);
});

test("recalculatePccForTeeConfigDay: one player's thrown failure does not prevent the other affected players' recalculations from completing and committing", async () => {
  const recordCalls: Array<{ playerId: string; newIndex: number; snapshot: Record<string, unknown> }> = [];
  const currentIndexByPlayer: Record<string, CurrentHandicapIndex | null> = {
    "player-1": { handicapIndex: null, lowHandicapIndex: null },
    "player-2": { handicapIndex: null, lowHandicapIndex: null },
    "player-3": { handicapIndex: null, lowHandicapIndex: null },
  };

  const pccService: PccService = {
    async getOrCreateDailyPcc() { throw new Error("not used"); },
    async calculateOrOverride() {
      return {
        dailyPcc: { id: "d1", teeConfigurationId: "tc-1", playedOn: "2026-05-01", pcc: 1, source: "override", updatedBy: "admin-1", updatedAt: new Date().toISOString() },
        updatedRounds: 3,
        affectedPlayerIds: ["player-1", "player-2", "player-3"],
      };
    },
  };

  const orchestrator = createRecalculationOrchestrator(
    fakePool(),
    fakeRoundsRepository({
      "player-1": makeDifferentials(3, 10),
      "player-2": makeDifferentials(3, 12),
      "player-3": makeDifferentials(3, 14),
    }),
    fakeHandicapHistoryService(currentIndexByPlayer, recordCalls, { throwForPlayerId: "player-2" }),
    pccService,
    silentLogger,
  );

  const result = await orchestrator.recalculatePccForTeeConfigDay("tc-1", "2026-05-01", 1, "admin-1");

  assert.equal(result.playerRecalculations.length, 3, "all three affected players were attempted, not just the ones before the failure");
  const byPlayer = Object.fromEntries(result.playerRecalculations.map((r) => [r.playerId, r]));
  assert.equal(byPlayer["player-1"]!.status, "eligible");
  assert.equal(byPlayer["player-2"]!.status, "failed", "the simulated failure is reported for player-2 specifically");
  assert.equal(byPlayer["player-3"]!.status, "eligible", "player-3, processed after the failing player-2, still completed successfully");

  // The successful players' results genuinely committed (recorded),
  // proving player-2's failure didn't roll anything else back.
  assert.equal(recordCalls.some((c) => c.playerId === "player-1"), true);
  assert.equal(recordCalls.some((c) => c.playerId === "player-3"), true);
  assert.equal(recordCalls.some((c) => c.playerId === "player-2"), false);
});
