import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoundsService } from "../src/application/rounds.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createLogger } from "../src/logger.ts";
import type {
  CreateHoleScoreInput,
  CreateRoundInput,
  HoleScore,
  Round,
  RoundScoreUpdate,
  RoundsRepository,
  RoundStatus,
  RoundSummary,
} from "../src/data/rounds.repository.ts";
import type { CoursesRepository, TeeConfiguration } from "../src/data/courses.repository.ts";
import type { PccService } from "../src/application/pcc.service.ts";

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

function roundsService(repository: RoundsRepository) {
  const courses = fakeCoursesRepository();
  const scoring = createScoringService(repository, courses, unusedPccService());
  return createRoundsService(repository, courses, scoring, silentLogger);
}

function fakeRepository(): RoundsRepository & { getCallCount: number } {
  const rounds = new Map<string, Round>();
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
      return rounds.get(id) ?? null;
    },
    async listByPlayer(playerId: string): Promise<RoundSummary[]> {
      return [...rounds.values()]
        .filter((r) => r.playerId === playerId)
        .map(({ id, playerId: p, teeConfigurationId, playedAt, status }) => ({ id, playerId: p, teeConfigurationId, playedAt, status }));
    },
    async setStatus(id: string, status: RoundStatus, rejectionReason?: string) {
      const round = rounds.get(id)!;
      round.status = status;
      round.rejectionReason = rejectionReason ?? null;
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

test("addHoleScore appends to an existing round -- the real incremental-entry workflow", async () => {
  const service = roundsService(fakeRepository());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  assert.equal(round.holeScores.length, 0);
  await service.addHoleScore(round.id, { holeNumber: 1, strokes: 5, fairwayResult: "missed_left" });
  const updated = await service.getRound(round.id);
  assert.equal(updated!.holeScores.length, 1);
  assert.equal(updated!.holeScores[0]!.fairwayResult, "missed_left");
});

test("setRoundStatus updates status and rejection reason", async () => {
  const service = roundsService(fakeRepository());
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  await service.setRoundStatus(round.id, "rejected", "Incomplete scorecard");
  const updated = await service.getRound(round.id);
  assert.equal(updated!.status, "rejected");
  assert.equal(updated!.rejectionReason, "Incomplete scorecard");
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

test("listRoundsForPlayer only returns that player's rounds", async () => {
  const service = roundsService(fakeRepository());
  await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await service.createRound({ playerId: "player-2", teeConfigurationId: "tee-1", playedAt: "2026-05-02T09:00:00.000Z" });

  const player1Rounds = await service.listRoundsForPlayer("player-1");
  assert.equal(player1Rounds.length, 1);
  assert.equal(player1Rounds[0]!.playerId, "player-1");
});
