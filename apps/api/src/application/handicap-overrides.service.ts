import type { Logger } from "../logger.ts";
import type {
  CreateHandicapOverrideInput,
  HandicapOverride,
  HandicapOverridesRepository,
} from "../data/handicap-overrides.repository.ts";

export interface HandicapOverridesService {
  createOverride(input: CreateHandicapOverrideInput): Promise<HandicapOverride>;
  listOverridesForPlayer(playerId: string): Promise<HandicapOverride[]>;
}

export function createHandicapOverridesService(
  repository: HandicapOverridesRepository,
  logger: Logger,
): HandicapOverridesService {
  return {
    async createOverride(input) {
      const override = await repository.create(input);
      logger.info("handicap override recorded", {
        overrideId: override.id,
        playerId: override.playerId,
        adminUserId: override.adminUserId,
        previousIndex: override.previousIndex,
        newIndex: override.newIndex,
      });
      return override;
    },

    async listOverridesForPlayer(playerId) {
      return repository.listForPlayer(playerId);
    },
  };
}
