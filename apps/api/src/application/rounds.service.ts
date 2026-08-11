import type { Logger } from "../logger.ts";
import type {
  CreateHoleScoreInput,
  CreateRoundInput,
  HoleScore,
  Round,
  RoundScoreUpdate,
  RoundsRepository,
  RoundStatus,
  RoundSummary,
} from "../data/rounds.repository.ts";
import type { CoursesRepository } from "../data/courses.repository.ts";
import type { ScoringService } from "./scoring.service.ts";

export interface RoundsService {
  createRound(input: CreateRoundInput): Promise<Round>;
  addHoleScore(roundId: string, input: CreateHoleScoreInput): Promise<HoleScore>;
  // Not exposed over HTTP in this issue -- computing these values is
  // Phase 2's WHS calculation logic. Exists so the repository layer isn't
  // write-only-by-nobody for columns this schema already has.
  updateScores(id: string, update: RoundScoreUpdate): Promise<Round>;
  getRound(id: string): Promise<Round | null>;
  listRoundsForPlayer(playerId: string): Promise<RoundSummary[]>;
  setRoundStatus(id: string, status: RoundStatus, rejectionReason?: string): Promise<void>;
}

// A hole's net_double_bogey_adjusted only depends on that hole's own
// strokes/par/stroke_index, the round's playing handicap, and the tee
// configuration's hole count -- never on any other hole in the round. So
// unlike the round-level aggregates (gross/adjusted gross score, totals,
// score differential -- ghs#20's ScoringService.recomputeRoundAggregates,
// an explicit, separately-triggered operation), it's computed here,
// immediately, at the moment a hole score is known -- not deferred to a
// later recompute step.
export function createRoundsService(
  repository: RoundsRepository,
  courses: CoursesRepository,
  scoring: ScoringService,
  logger: Logger,
): RoundsService {
  return {
    async createRound(input) {
      let holeScores = input.holeScores ?? [];
      if (holeScores.length > 0) {
        const teeConfiguration = await courses.getTeeConfiguration(input.teeConfigurationId);
        if (!teeConfiguration) throw new Error("tee configuration not found");

        holeScores = holeScores.map((hole) => ({
          ...hole,
          netDoubleBogeyAdjusted: scoring.computeHoleAdjustment({
            holeNumber: hole.holeNumber,
            strokes: hole.strokes,
            playingHandicap: input.playingHandicap ?? 0,
            holes: teeConfiguration.holes,
            holeCount: teeConfiguration.holeCount,
          }),
        }));
      }

      const round = await repository.create({ ...input, holeScores });
      logger.info("round created", { roundId: round.id, playerId: round.playerId, holeCount: round.holeScores.length });
      return round;
    },

    async addHoleScore(roundId, input) {
      const round = await repository.get(roundId);
      if (!round) throw new Error("round not found");

      const teeConfiguration = await courses.getTeeConfiguration(round.teeConfigurationId);
      if (!teeConfiguration) throw new Error("tee configuration not found");

      const netDoubleBogeyAdjusted = scoring.computeHoleAdjustment({
        holeNumber: input.holeNumber,
        strokes: input.strokes,
        playingHandicap: round.playingHandicap ?? 0,
        holes: teeConfiguration.holes,
        holeCount: teeConfiguration.holeCount,
      });

      const holeScore = await repository.addHoleScore(roundId, { ...input, netDoubleBogeyAdjusted });
      logger.info("hole score recorded", { roundId, holeNumber: holeScore.holeNumber });
      return holeScore;
    },

    async updateScores(id, update) {
      const round = await repository.updateScores(id, update);
      logger.info("round scores updated", { roundId: id, fields: Object.keys(update) });
      return round;
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
