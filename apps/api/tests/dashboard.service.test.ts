import { test } from "node:test";
import assert from "node:assert/strict";
import { createDashboardService } from "../src/application/dashboard.service.ts";
import type { HandicapHistoryService } from "../src/application/handicap-history.service.ts";
import type { RoundsService } from "../src/application/rounds.service.ts";
import type { Logger } from "../src/logger.ts";
import type { HandicapHistoryRecord } from "../src/data/handicap-history.repository.ts";
import type { PlayerRoundListItem, PlayerStats } from "../src/data/rounds.repository.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database. Proves the
// per-section failure isolation this issue's own acceptance criteria
// calls out as the genuinely new, worth-getting-right part of this
// endpoint (design doc section L.2): one section's rejected promise
// must never take the other sections down with it.

const SAMPLE_HISTORY: HandicapHistoryRecord[] = [
  {
    id: "h1", playerId: "player-1", method: "calculated", handicapIndex: 14.2, previousIndex: 15.0,
    reason: null, createdBy: null, calculationSnapshot: null, calculationDate: "2026-05-01", createdAt: "2026-05-01",
  },
];

const SAMPLE_ROUNDS: PlayerRoundListItem[] = [
  { id: "r1", playerId: "player-1", courseId: "c1", courseName: "Sunningdale", teeConfigurationId: "t1", teeConfigurationName: "White", playedAt: "2026-05-01T09:00:00.000Z", status: "approved" },
];

const SAMPLE_STATS: PlayerStats = {
  roundsCount: 1, coursesCount: 1, holesCount: 18, girPercentage: 50, fairwayHitPercentage: 60,
  fairwayMissedLeftPercentage: 20, fairwayMissedRightPercentage: 20, puttsPerRound: 32, puttsHolesCount: 18,
  onePuttHoles: 3, threePlusPuttHoles: 1, penaltiesPerRound: 1, sandInteractionPercentage: 10,
};

// Records every error() call rather than writing to stdout -- review
// finding, PR #183: toSection previously discarded a section's error
// entirely, so a real failure became a silent 200 with no trace
// anywhere. These tests assert the logger actually captured it.
function fakeLogger(): Logger & { errors: Array<{ message: string; fields?: Record<string, unknown> }> } {
  const errors: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  return {
    errors,
    debug() {},
    info() {},
    warn() {},
    error(message, fields) {
      errors.push({ message, fields });
    },
  };
}

function fakeHandicapHistoryService(overrides: Partial<HandicapHistoryService> = {}): HandicapHistoryService {
  return {
    async getCurrentIndex() {
      throw new Error("not used by these tests");
    },
    async getCurrentIndexForUpdate() {
      throw new Error("not used by these tests");
    },
    async listHistoryForPlayer() {
      return SAMPLE_HISTORY;
    },
    async recordCalculatedResult() {
      throw new Error("not used by these tests");
    },
    async recordManualOverride() {
      throw new Error("not used by these tests");
    },
    ...overrides,
  };
}

function fakeRoundsService(overrides: Partial<RoundsService> = {}): RoundsService {
  const notUsed = async () => {
    throw new Error("not used by these tests");
  };
  return {
    createRound: notUsed,
    addHoleScore: notUsed,
    updateScores: notUsed,
    getRound: notUsed,
    async listRoundsForPlayer() {
      return SAMPLE_ROUNDS;
    },
    listPendingQueue: notUsed,
    listAdminRounds: notUsed,
    async getPlayerStats() {
      return SAMPLE_STATS;
    },
    submitForReview: notUsed,
    approveRound: notUsed,
    rejectRound: notUsed,
    deleteRound: notUsed,
    reopenForAmendment: notUsed,
    updatePlayedAt: notUsed,
    ...overrides,
  } as RoundsService;
}

test("getPlayerDashboard returns real data for every section when all three underlying calls succeed", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(fakeHandicapHistoryService(), fakeRoundsService(), logger);

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { data: SAMPLE_HISTORY });
  assert.deepEqual(dashboard.recentRounds, { data: SAMPLE_ROUNDS });
  assert.deepEqual(dashboard.stats, { data: SAMPLE_STATS });
  assert.equal(logger.errors.length, 0, "nothing failed -- nothing should be logged");
});

test("one section's rejected promise becomes { error: true } without affecting the other two sections (per-section failure isolation, ghs#176)", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService({
      async listHistoryForPlayer() {
        throw new Error("handicap_history table temporarily unavailable");
      },
    }),
    fakeRoundsService(),
    logger,
  );

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { error: true });
  // The other two sections are untouched real data, not swept into the
  // same failure -- the entire point of this pattern over a single
  // try/catch around the whole aggregation.
  assert.deepEqual(dashboard.recentRounds, { data: SAMPLE_ROUNDS });
  assert.deepEqual(dashboard.stats, { data: SAMPLE_STATS });

  // Review finding, PR #183: the failure must be logged, not just
  // swallowed into a silent 200 -- verified here, not just assumed from
  // the source reading correctly.
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0]!.message, "dashboard section failed");
  assert.equal(logger.errors[0]!.fields?.section, "handicapHistory");
  assert.equal(logger.errors[0]!.fields?.playerId, "player-1");
  assert.match(String(logger.errors[0]!.fields?.error), /handicap_history table temporarily unavailable/);
});

test("a second section can independently fail while a third stays real data", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService({
      async listRoundsForPlayer() {
        throw new Error("rounds query timed out");
      },
    }),
    logger,
  );

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { data: SAMPLE_HISTORY });
  assert.deepEqual(dashboard.recentRounds, { error: true });
  assert.deepEqual(dashboard.stats, { data: SAMPLE_STATS });
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0]!.fields?.section, "recentRounds");
});

test("every section can fail independently at once -- still resolves (not a rejected promise/blanket 500), just three error markers, each logged", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService({
      async listHistoryForPlayer() {
        throw new Error("boom 1");
      },
    }),
    fakeRoundsService({
      async listRoundsForPlayer() {
        throw new Error("boom 2");
      },
      async getPlayerStats() {
        throw new Error("boom 3");
      },
    }),
    logger,
  );

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { error: true });
  assert.deepEqual(dashboard.recentRounds, { error: true });
  assert.deepEqual(dashboard.stats, { error: true });
  assert.equal(logger.errors.length, 3);
  assert.deepEqual(logger.errors.map((e) => e.fields?.section).sort(), ["handicapHistory", "recentRounds", "stats"]);
});
