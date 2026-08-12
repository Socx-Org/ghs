import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { createRoundsService, InvalidRoundTransitionError, RoundNotFoundError } from "../src/application/rounds.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createLogger } from "../src/logger.ts";
import type {
  CreateHoleScoreInput,
  CreateRoundInput,
  HoleScore,
  Round,
  RoundForUpdate,
  RoundScoreUpdate,
  RoundsRepository,
  RoundStatus,
  RoundSummary,
} from "../src/data/rounds.repository.ts";
import type { CoursesRepository, TeeConfiguration } from "../src/data/courses.repository.ts";
import type { DailyPcc } from "../src/data/pcc.repository.ts";
import type { PccService } from "../src/application/pcc.service.ts";
import type { RecalculationOrchestrator, RecalculationOutcome, RecalculationTrigger } from "../src/application/recalculation.service.ts";
import type { NotificationHistoryRecord, NotificationsRepository, RecordNotificationInput } from "../src/data/notifications.repository.ts";

// A single 18-hole tee configuration, reused by every test below --
// enough hole metadata (hole 1, par 4, stroke index 7) for the
// net-double-bogey computation rounds.service.ts now performs at
// hole-insertion time.
const FAKE_TEE_CONFIGURATION: TeeConfiguration = {
  id: "tee-1",
  name: "White",
  holeCount: 18,
  courseRating: 72.0,
  slopeRating: 113,
  holes: [{ id: "hole-1", holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
};

function fakeCoursesRepository(): CoursesRepository {
  return {
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used by these tests");
    },
    async get() {
      return null;
    },
    async getTeeConfiguration(id) {
      return id === FAKE_TEE_CONFIGURATION.id ? FAKE_TEE_CONFIGURATION : null;
    },
  };
}

function unusedPccService(): PccService {
  return {
    async getOrCreateDailyPcc() {
      throw new Error("not used by these tests -- only computeHoleAdjustment is exercised here");
    },
    async calculateOrOverride() {
      throw new Error("not used by these tests -- only computeHoleAdjustment is exercised here");
    },
  };
}

// A working (not throwing) PCC fake, needed by the approve-workflow tests
// below: approveRound calls scoring.recomputeRoundAggregates before its own
// transaction, which unconditionally calls getOrCreateDailyPcc.
function zeroPccService(): PccService {
  const daily: DailyPcc = {
    id: "daily-pcc-1",
    teeConfigurationId: FAKE_TEE_CONFIGURATION.id,
    playedOn: "2026-05-01",
    pcc: 0,
    source: "calculated",
    updatedBy: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  return {
    async getOrCreateDailyPcc() {
      return daily;
    },
    async calculateOrOverride() {
      throw new Error("not used by these tests");
    },
  };
}

// A minimal fake pg.Pool -- only used for runWorkflowTransition's own
// BEGIN/COMMIT/ROLLBACK calls. The fake RoundsRepository below ignores
// whatever client it's given entirely, so this fake client is never
// actually queried for real data (same pattern as
// recalculation.service.test.ts's fakePool).
function fakePool(): Pool {
  const fakeClient = {
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => { /* no-op */ },
  } as unknown as PoolClient;
  return { connect: async () => fakeClient } as unknown as Pool;
}

// Records every recalculatePlayerHandicap call so tests can assert on
// which trigger fired and whether it ran inside the caller's transaction
// (a client was passed), without re-exercising ghs#24's own recalculation
// logic -- that's already covered by recalculation.service.test.ts.
function fakeRecalculationOrchestrator(): RecalculationOrchestrator & {
  calls: Array<{ playerId: string; trigger: RecalculationTrigger; hadClient: boolean }>;
} {
  const calls: Array<{ playerId: string; trigger: RecalculationTrigger; hadClient: boolean }> = [];
  return {
    calls,
    async recalculatePlayerHandicap(playerId, trigger, client) {
      calls.push({ playerId, trigger, hadClient: client !== undefined });
      const outcome: RecalculationOutcome = {
        playerId, trigger, status: "eligible", handicapIndex: 12.3, historyRecordId: "history-1",
      };
      return outcome;
    },
    async recalculatePccForTeeConfigDay() {
      throw new Error("not used by these tests");
    },
  };
}

function fakeNotificationsRepository(): NotificationsRepository & { recordedCalls: RecordNotificationInput[] } {
  const recordedCalls: RecordNotificationInput[] = [];
  return {
    recordedCalls,
    async record(input) {
      recordedCalls.push(input);
      const record: NotificationHistoryRecord = { id: String(recordedCalls.length), playerId: input.playerId, eventType: input.eventType, payload: input.payload, createdAt: new Date().toISOString() };
      return record;
    },
    async listForPlayer() {
      return [];
    },
  };
}

function roundsService(
  repository: RoundsRepository,
  recalculation: RecalculationOrchestrator = fakeRecalculationOrchestrator(),
  pccService: PccService = unusedPccService(),
  notifications: NotificationsRepository = fakeNotificationsRepository(),
) {
  const courses = fakeCoursesRepository();
  const scoring = createScoringService(repository, courses, pccService);
  return createRoundsService(fakePool(), repository, courses, scoring, recalculation, notifications, silentLogger);
}

function fakeRepository(): RoundsRepository & { getCallCount: number } {
  const rounds = new Map<string, Round>();
  const deleted = new Set<string>();
  let nextRoundId = 1;
  let nextHoleId = 1;
  const state = { getCallCount: 0 };

  return {
    get getCallCount() {
      return state.getCallCount;
    },
    async create(input: CreateRoundInput) {
      const round: Round = {
        id: String(nextRoundId++),
        playerId: input.playerId,
        teeConfigurationId: input.teeConfigurationId,
        playedAt: input.playedAt,
        playingHandicap: input.playingHandicap ?? null,
        grossScore: null,
        adjustedGrossScore: null,
        scoreDifferential: null,
        pcc: null,
        totalPutts: null,
        totalGir: null,
        totalFairwaysHit: null,
        totalPenalties: null,
        isTournament: input.isTournament ?? false,
        is9Hole: input.is9Hole ?? false,
        status: "pending",
        rejectionReason: null,
        holeScores: (input.holeScores ?? []).map((h) => ({
          id: String(nextHoleId++),
          holeNumber: h.holeNumber,
          strokes: h.strokes,
          putts: h.putts ?? null,
          gir: h.gir ?? false,
          fairwayResult: h.fairwayResult ?? null,
          inSand: h.inSand ?? false,
          penalties: h.penalties ?? 0,
          netDoubleBogeyAdjusted: h.netDoubleBogeyAdjusted ?? 0,
        })),
      };
      rounds.set(round.id, round);
      return round;
    },
    async addHoleScore(roundId: string, input: CreateHoleScoreInput) {
      const round = rounds.get(roundId)!;
      const holeScore: HoleScore = {
        id: String(nextHoleId++),
        holeNumber: input.holeNumber,
        strokes: input.strokes,
        putts: input.putts ?? null,
        gir: input.gir ?? false,
        fairwayResult: input.fairwayResult ?? null,
        inSand: input.inSand ?? false,
        penalties: input.penalties ?? 0,
        netDoubleBogeyAdjusted: input.netDoubleBogeyAdjusted ?? 0,
      };
      round.holeScores.push(holeScore);
      return holeScore;
    },
    async updateScores(id: string, update: RoundScoreUpdate) {
      const round = rounds.get(id)!;
      Object.assign(round, update);
      return round;
    },
    async get(id: string) {
      state.getCallCount += 1;
      if (deleted.has(id)) return null;
      return rounds.get(id) ?? null;
    },
    async listByPlayer(playerId: string): Promise<RoundSummary[]> {
      return [...rounds.values()]
        .filter((r) => r.playerId === playerId && !deleted.has(r.id))
        .map(({ id, playerId: p, teeConfigurationId, playedAt, status }) => ({ id, playerId: p, teeConfigurationId, playedAt, status }));
    },
    async listApprovedDifferentialsForPlayer(playerId: string) {
      return [...rounds.values()]
        .filter((r) => r.playerId === playerId && r.status === "approved" && r.scoreDifferential !== null && !deleted.has(r.id))
        .map((r) => ({ roundId: r.id, playedAt: r.playedAt, scoreDifferential: r.scoreDifferential!, is9Hole: r.is9Hole }));
    },
    async setStatus(id: string, status: RoundStatus, rejectionReason?: string) {
      const round = rounds.get(id)!;
      round.status = status;
      round.rejectionReason = rejectionReason ?? null;
    },
    async getForUpdate(id: string): Promise<RoundForUpdate | null> {
      if (deleted.has(id)) return null;
      const round = rounds.get(id);
      if (!round) return null;
      return {
        id: round.id,
        playerId: round.playerId,
        teeConfigurationId: round.teeConfigurationId,
        playedAt: round.playedAt,
        status: round.status,
        scoreDifferential: round.scoreDifferential,
      };
    },
    async softDelete(id: string) {
      deleted.add(id);
    },
  };
}

const silentLogger = createLogger("test");

test("createRound persists via the repository, including nested hole scores", async () => {
  const service = roundsService(fakeRepository());

  const round = await service.createRound({
    playerId: "player-1",
    teeConfigurationId: "tee-1",
    playedAt: "2026-05-01T09:00:00.000Z",
    holeScores: [{ holeNumber: 1, strokes: 4, fairwayResult: "hit" }],
  });

  assert.equal(round.status, "pending");
  assert.equal(round.holeScores.length, 1);
  assert.equal(round.holeScores[0]!.fairwayResult, "hit");
});

test("createRound writes a round_submitted notification (ghs#25)", async () => {
  const notifications = fakeNotificationsRepository();
  const service = roundsService(fakeRepository(), fakeRecalculationOrchestrator(), unusedPccService(), notifications);

  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  assert.equal(notifications.recordedCalls.length, 1);
  const call = notifications.recordedCalls[0]!;
  assert.equal(call.playerId, "player-1");
  assert.equal(call.eventType, "round_submitted");
  assert.equal(call.payload.roundId, round.id);
});

test("approveRound writes a round_approved notification, and rejectRound writes a round_rejected notification with the reason (ghs#25)", async () => {
  const notifications = fakeNotificationsRepository();
  const service = roundsService(fakeRepository(), fakeRecalculationOrchestrator(), zeroPccService(), notifications);

  const approvedRound = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await service.addHoleScore(approvedRound.id, { holeNumber: 1, strokes: 4 });
  await service.approveRound(approvedRound.id);

  const rejectedRound = await service.createRound({ playerId: "player-2", teeConfigurationId: "tee-1", playedAt: "2026-05-02T09:00:00.000Z" });
  await service.rejectRound(rejectedRound.id, "Incomplete scorecard");

  const eventTypes = notifications.recordedCalls.map((c) => c.eventType);
  assert.deepEqual(eventTypes, ["round_submitted", "round_approved", "round_submitted", "round_rejected"]);

  const rejectedCall = notifications.recordedCalls.find((c) => c.eventType === "round_rejected")!;
  assert.equal(rejectedCall.payload.reason, "Incomplete scorecard");
});

test("reopenForAmendment writes no notification at all (platform owner decision, 2026-08-12)", async () => {
  const repo = fakeRepository();
  const notifications = fakeNotificationsRepository();
  const service = roundsService(repo, fakeRecalculationOrchestrator(), unusedPccService(), notifications);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await repo.setStatus(round.id, "approved");
  notifications.recordedCalls.length = 0; // discard the round_submitted call above

  await service.reopenForAmendment(round.id, "Scorecard under review");

  assert.equal(notifications.recordedCalls.length, 0);
});

test("addHoleScore appends to an existing round -- the real incremental-entry workflow", async () => {
  const service = roundsService(fakeRepository());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  assert.equal(round.holeScores.length, 0);
  await service.addHoleScore(round.id, { holeNumber: 1, strokes: 5, fairwayResult: "missed_left" });
  const updated = await service.getRound(round.id);
  assert.equal(updated!.holeScores.length, 1);
  assert.equal(updated!.holeScores[0]!.fairwayResult, "missed_left");
});

test("approveRound rescoring then approves and recalculates via the ghs#24 orchestrator, in caller-managed (client-threaded) mode", async () => {
  const repo = fakeRepository();
  const recalculation = fakeRecalculationOrchestrator();
  const service = roundsService(repo, recalculation, zeroPccService());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await service.addHoleScore(round.id, { holeNumber: 1, strokes: 4 });

  const result = await service.approveRound(round.id);

  assert.equal(result.round!.status, "approved");
  assert.equal(recalculation.calls.length, 1);
  assert.equal(recalculation.calls[0]!.playerId, "player-1");
  assert.equal(recalculation.calls[0]!.trigger, "round_approved");
  assert.equal(recalculation.calls[0]!.hadClient, true, "the state change and recalculation must run on the same transaction client (ghs#24 atomicity)");
  assert.equal(result.recalculation!.status, "eligible");
});

test("approveRound rejects a round that isn't pending or amending", async () => {
  const repo = fakeRepository();
  const service = roundsService(repo, fakeRecalculationOrchestrator(), zeroPccService());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await repo.setStatus(round.id, "rejected", "already handled");

  await assert.rejects(() => service.approveRound(round.id), InvalidRoundTransitionError);
});

test("approveRound on a missing round throws RoundNotFoundError", async () => {
  const service = roundsService(fakeRepository(), fakeRecalculationOrchestrator(), zeroPccService());
  await assert.rejects(() => service.approveRound("does-not-exist"), RoundNotFoundError);
});

test("approveRound validates status before rescoring -- a non-approvable round is never rescored as a side effect of the failed attempt (caught in review, PR #32)", async () => {
  const repo = fakeRepository();
  const service = roundsService(repo, fakeRecalculationOrchestrator(), zeroPccService());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await service.addHoleScore(round.id, { holeNumber: 1, strokes: 4 });
  await repo.setStatus(round.id, "rejected", "already handled");

  await assert.rejects(() => service.approveRound(round.id), InvalidRoundTransitionError);

  const afterFailedApproval = await repo.get(round.id);
  assert.equal(afterFailedApproval!.status, "rejected", "status must remain unchanged");
  assert.equal(afterFailedApproval!.scoreDifferential, null, "rescoreBeforeApproval must not run -- no score fields should be persisted for a round that can't be approved");
  assert.equal(afterFailedApproval!.grossScore, null);
});

test("rejectRound requires a non-empty reason", async () => {
  const service = roundsService(fakeRepository());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  await assert.rejects(() => service.rejectRound(round.id, ""), InvalidRoundTransitionError);
  await assert.rejects(() => service.rejectRound(round.id, "   "), InvalidRoundTransitionError);
});

test("rejectRound recalculates when the round already carries a differential -- the legacy bug (ghs#23) this fixes: legacy only logged an audit event here and never actually recalculated", async () => {
  const repo = fakeRepository();
  const recalculation = fakeRecalculationOrchestrator();
  const service = roundsService(repo, recalculation);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await repo.updateScores(round.id, { scoreDifferential: 12.3 });
  // Simulates the real path this covers: previously approved (so it
  // carries a differential), then reopened for amendment -- rejectRound
  // itself only ever accepts 'pending'/'amending', never 'approved'
  // directly.
  await repo.setStatus(round.id, "amending");

  const result = await service.rejectRound(round.id, "Scorecard dispute");

  assert.equal(result.round!.status, "rejected");
  assert.equal(result.round!.rejectionReason, "Scorecard dispute");
  assert.equal(recalculation.calls.length, 1, "must actually recalculate, not just log");
  assert.equal(recalculation.calls[0]!.trigger, "round_rejected");
  assert.equal(recalculation.calls[0]!.hadClient, true);
});

test("rejectRound skips recalculation when the round never had a differential -- nothing to retract", async () => {
  const repo = fakeRepository();
  const recalculation = fakeRecalculationOrchestrator();
  const service = roundsService(repo, recalculation);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  const result = await service.rejectRound(round.id, "Incomplete scorecard");

  assert.equal(result.round!.status, "rejected");
  assert.equal(result.recalculation, null);
  assert.equal(recalculation.calls.length, 0);
});

test("deleteRound soft-deletes and recalculates when the round had a differential", async () => {
  const repo = fakeRepository();
  const recalculation = fakeRecalculationOrchestrator();
  const service = roundsService(repo, recalculation);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await repo.updateScores(round.id, { scoreDifferential: 8.0 });
  await repo.setStatus(round.id, "approved");

  const result = await service.deleteRound(round.id);

  assert.equal(await service.getRound(round.id), null, "soft-deleted rounds are excluded from reads");
  assert.equal(recalculation.calls.length, 1);
  assert.equal(recalculation.calls[0]!.trigger, "round_deleted");
  assert.equal(result.recalculation!.status, "eligible");
});

test("reopenForAmendment requires a non-empty reason", async () => {
  const repo = fakeRepository();
  const service = roundsService(repo);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await repo.setStatus(round.id, "approved");

  await assert.rejects(() => service.reopenForAmendment(round.id, ""), InvalidRoundTransitionError);
});

test("reopenForAmendment only accepts an approved round", async () => {
  const repo = fakeRepository();
  const service = roundsService(repo);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  // Still "pending" -- never approved.

  await assert.rejects(() => service.reopenForAmendment(round.id, "Scorecard correction needed"), InvalidRoundTransitionError);
});

test("reopenForAmendment moves an approved round to 'amending' and recalculates -- retraction happens for free via the status change itself, no special-case logic", async () => {
  const repo = fakeRepository();
  const recalculation = fakeRecalculationOrchestrator();
  const service = roundsService(repo, recalculation);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await repo.updateScores(round.id, { scoreDifferential: 10.0 });
  await repo.setStatus(round.id, "approved");

  const result = await service.reopenForAmendment(round.id, "Hole 7 score disputed");

  assert.equal(result.round!.status, "amending");
  assert.equal(recalculation.calls.length, 1);
  assert.equal(recalculation.calls[0]!.trigger, "amendment_reopened");
  // The round is no longer 'approved', so listApprovedDifferentialsForPlayer
  // (what the orchestrator reads) already excludes it -- nothing else to do.
  assert.deepEqual(await repo.listApprovedDifferentialsForPlayer("player-1"), []);
});

test("re-approving an amending round uses the 'amendment_approved' trigger, not 'round_approved'", async () => {
  const repo = fakeRepository();
  const recalculation = fakeRecalculationOrchestrator();
  const service = roundsService(repo, recalculation, zeroPccService());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await service.addHoleScore(round.id, { holeNumber: 1, strokes: 4 });
  await repo.setStatus(round.id, "amending");

  const result = await service.approveRound(round.id);

  assert.equal(result.round!.status, "approved");
  assert.equal(recalculation.calls[0]!.trigger, "amendment_approved");
});

test("createRound computes net_double_bogey_adjusted per hole at insertion time -- the ghs#20 wiring, not left at the repository's default of 0", async () => {
  const service = roundsService(fakeRepository());
  // hole 1: par 4, stroke index 7. playingHandicap 10 on an 18-hole
  // round -> base 0, remainder 10, stroke index 7 <= 10 -> 1 stroke
  // received. Net double bogey cap = 4 + 2 + 1 = 7. strokes=9 is capped
  // down to 7.
  const round = await service.createRound({
    playerId: "player-1",
    teeConfigurationId: "tee-1",
    playedAt: "2026-05-01T09:00:00.000Z",
    playingHandicap: 10,
    holeScores: [{ holeNumber: 1, strokes: 9 }],
  });

  assert.equal(round.holeScores[0]!.netDoubleBogeyAdjusted, 7);
});

test("addHoleScore computes net_double_bogey_adjusted for the incrementally-added hole, using the round's own playing handicap", async () => {
  const service = roundsService(fakeRepository());
  const round = await service.createRound({
    playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z", playingHandicap: 10,
  });

  const holeScore = await service.addHoleScore(round.id, { holeNumber: 1, strokes: 9 });
  assert.equal(holeScore.netDoubleBogeyAdjusted, 7);
});

test("addHoleScore skips its own repository fetch when the caller already has the round -- avoids the redundant query the HTTP route used to trigger (PR #27 review fix)", async () => {
  const repo = fakeRepository();
  const service = roundsService(repo);
  const round = await service.createRound({
    playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z", playingHandicap: 10,
  });

  const fetched = await service.getRound(round.id); // e.g. the route's own auth-check fetch
  const getCallsBeforeAddHoleScore = repo.getCallCount;

  const holeScore = await service.addHoleScore(round.id, { holeNumber: 1, strokes: 9 }, fetched!);
  assert.equal(holeScore.netDoubleBogeyAdjusted, 7, "still computes correctly using the preloaded round");
  assert.equal(repo.getCallCount, getCallsBeforeAddHoleScore, "no additional repository.get() call was made");
});

test("addHoleScore still fetches the round itself when no preloaded round is given -- existing callers are unaffected", async () => {
  const repo = fakeRepository();
  const service = roundsService(repo);
  const round = await service.createRound({
    playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z", playingHandicap: 10,
  });

  const getCallsBefore = repo.getCallCount;
  await service.addHoleScore(round.id, { holeNumber: 1, strokes: 9 });
  assert.equal(repo.getCallCount, getCallsBefore + 1, "falls back to fetching when no preloaded round is passed");
});

test("addHoleScore ignores a preloaded round whose id doesn't match roundId and fetches the correct one instead (PR #30 review fix)", async () => {
  const repo = fakeRepository();
  const service = roundsService(repo);

  // Two real rounds with different playing handicaps -- if the mismatched
  // preloaded round were wrongly trusted, the adjustment below would be
  // computed against handicap 0 (wrongRound's) instead of 10 (the real
  // target round's), producing a different, wrong result.
  const wrongRound = await service.createRound({
    playerId: "player-2", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z", playingHandicap: 0,
  });
  const targetRound = await service.createRound({
    playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z", playingHandicap: 10,
  });

  const getCallsBefore = repo.getCallCount;
  const holeScore = await service.addHoleScore(targetRound.id, { holeNumber: 1, strokes: 9 }, wrongRound);

  assert.equal(repo.getCallCount, getCallsBefore + 1, "fell back to fetching the real round rather than trusting the mismatched one");
  assert.equal(holeScore.netDoubleBogeyAdjusted, 7, "computed against the real target round's handicap (10), not the mismatched one's (0, which would give 6)");
});

test("listRoundsForPlayer only returns that player's rounds", async () => {
  const service = roundsService(fakeRepository());
  await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await service.createRound({ playerId: "player-2", teeConfigurationId: "tee-1", playedAt: "2026-05-02T09:00:00.000Z" });

  const player1Rounds = await service.listRoundsForPlayer("player-1");
  assert.equal(player1Rounds.length, 1);
  assert.equal(player1Rounds[0]!.playerId, "player-1");
});
