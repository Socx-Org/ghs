import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoundsService } from "../src/application/rounds.service.ts";
import { createLogger } from "../src/logger.ts";
import type {
  CreateHoleScoreInput,
  CreateRoundInput,
  HoleScore,
  Round,
  RoundsRepository,
  RoundStatus,
  RoundSummary,
} from "../src/data/rounds.repository.ts";

function fakeRepository(): RoundsRepository {
  const rounds = new Map<string, Round>();
  let nextRoundId = 1;
  let nextHoleId = 1;

  return {
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
    async get(id: string) {
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
  const service = createRoundsService(fakeRepository(), silentLogger);

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
  const service = createRoundsService(fakeRepository(), silentLogger);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  assert.equal(round.holeScores.length, 0);
  await service.addHoleScore(round.id, { holeNumber: 1, strokes: 5, fairwayResult: "missed_left" });
  const updated = await service.getRound(round.id);
  assert.equal(updated!.holeScores.length, 1);
  assert.equal(updated!.holeScores[0]!.fairwayResult, "missed_left");
});

test("setRoundStatus updates status and rejection reason", async () => {
  const service = createRoundsService(fakeRepository(), silentLogger);
  const round = await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });

  await service.setRoundStatus(round.id, "rejected", "Incomplete scorecard");
  const updated = await service.getRound(round.id);
  assert.equal(updated!.status, "rejected");
  assert.equal(updated!.rejectionReason, "Incomplete scorecard");
});

test("listRoundsForPlayer only returns that player's rounds", async () => {
  const service = createRoundsService(fakeRepository(), silentLogger);
  await service.createRound({ playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T09:00:00.000Z" });
  await service.createRound({ playerId: "player-2", teeConfigurationId: "tee-1", playedAt: "2026-05-02T09:00:00.000Z" });

  const player1Rounds = await service.listRoundsForPlayer("player-1");
  assert.equal(player1Rounds.length, 1);
  assert.equal(player1Rounds[0]!.playerId, "player-1");
});
