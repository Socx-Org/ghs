import type { Logger } from "../logger.ts";
import type {
  CreateHandicapOverrideInput,
  HandicapOverride,
  HandicapOverridesRepository,
} from "../data/handicap-overrides.repository.ts";
import type { HandicapHistoryService } from "./handicap-history.service.ts";
import { InvalidHandicapChangeError } from "./handicap-history.service.ts";

export interface HandicapOverridesService {
  createOverride(input: CreateHandicapOverrideInput): Promise<HandicapOverride>;
  listOverridesForPlayer(playerId: string): Promise<HandicapOverride[]>;
}

// handicap_overrides (ghs#10) remains the admin-action audit log --
// unchanged, still append-only, still always gets a row regardless of
// value. handicap_history (ghs#21) is the separate index-value timeline;
// this service writes to both, through handicap-history.service.ts's
// shared recordManualOverride -- the same function the calculated-
// recalculation path (ghs#22) will use, not a second implementation.
export function createHandicapOverridesService(
  repository: HandicapOverridesRepository,
  handicapHistory: HandicapHistoryService,
  logger: Logger,
): HandicapOverridesService {
  return {
    async createOverride(input) {
      // Validated here, before either write, not after the first one
      // succeeds -- handicap_overrides and handicap_history are two
      // separate repositories with no shared transaction, so failing
      // validation between the two writes would leave a real,
      // inconsistent handicap_overrides row behind. Found while writing
      // this issue's own tests (calling the service directly, bypassing
      // the route's own equivalent check), fixed here rather than only
      // in the route.
      if (!input.reason.trim()) {
        throw new InvalidHandicapChangeError("reason is required for a manual override");
      }

      const override = await repository.create(input);
      logger.info("handicap override recorded", {
        overrideId: override.id,
        playerId: override.playerId,
        adminUserId: override.adminUserId,
        previousIndex: override.previousIndex,
        newIndex: override.newIndex,
      });

      await handicapHistory.recordManualOverride(
        override.playerId,
        override.newIndex,
        override.previousIndex,
        override.reason,
        override.adminUserId,
        override.createdAt,
      );

      return override;
    },

    async listOverridesForPlayer(playerId) {
      return repository.listForPlayer(playerId);
    },
  };
}
