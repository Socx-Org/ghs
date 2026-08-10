import type { Logger } from "../logger.ts";
import type {
  CreateHoleScoreInput,
  CreateRoundInput,
  HoleScore,
  Round,
  RoundsRepository,
  RoundStatus,
  RoundSummary,
} from "../data/rounds.repository.ts";

export interface RoundsService {
  createRound(input: CreateRoundInput): Promise<Round>;
  addHoleScore(roundId: string, input: CreateHoleScoreInput): Promise<HoleScore>;
  getRound(id: string): Promise<Round | null>;
  listRoundsForPlayer(playerId: string): Promise<RoundSummary[]>;
  setRoundStatus(id: string, status: RoundStatus, rejectionReason?: string): Promise<void>;
}

export function createRoundsService(repository: RoundsRepository, logger: Logger): RoundsService {
  return {
    async createRound(input) {
      const round = await repository.create(input);
      logger.info("round created", { roundId: round.id, playerId: round.playerId, holeCount: round.holeScores.length });
      return round;
    },

    async addHoleScore(roundId, input) {
      const holeScore = await repository.addHoleScore(roundId, input);
      logger.info("hole score recorded", { roundId, holeNumber: holeScore.holeNumber });
      return holeScore;
    },

    async getRound(id) {
      return repository.get(id);
    },

    async listRoundsForPlayer(playerId) {
      return repository.listByPlayer(playerId);
    },

    async setRoundStatus(id, status, rejectionReason) {
      await repository.setStatus(id, status, rejectionReason);
      logger.info("round status changed", { roundId: id, status });
    },
  };
}
