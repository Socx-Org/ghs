import type { Pool } from "pg";
import type { Logger } from "../logger.ts";
import type {
  CreateHandicapOverrideInput,
  HandicapOverride,
  HandicapOverridesRepository,
} from "../data/handicap-overrides.repository.ts";
import type { HandicapHistoryService } from "./handicap-history.service.ts";
import { InvalidHandicapChangeError } from "./handicap-history.service.ts";
import type { NotificationsRepository } from "../data/notifications.repository.ts";

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
  pool: Pool,
  repository: HandicapOverridesRepository,
  handicapHistory: HandicapHistoryService,
  notifications: NotificationsRepository,
  logger: Logger,
): HandicapOverridesService {
  return {
    async createOverride(input) {
      // Validated here, before any write, not after the first one
      // succeeds.
      if (!input.reason.trim()) {
        throw new InvalidHandicapChangeError("reason is required for a manual override");
      }

      // A real, single transaction now spans all three writes
      // (handicap_overrides, handicap_history, and ghs#25's
      // manual_override notification) -- previously handicap_overrides
      // and handicap_history were two independent, unthreaded calls (a
      // known gap flagged in this file's own prior comment: failing
      // validation between the two writes could leave a real,
      // inconsistent handicap_overrides row behind). ghs#25's own
      // transactional requirement for the notification write is what
      // finally forced fixing this, rather than adding a third
      // independent write on top of an already-known gap.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const override = await repository.create(input, client);
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
          client,
        );

        // Always fires, distinct from the general "handicap_changed"
        // (calculated-only) event -- ghs#25's own domain trigger table:
        // "Manual handicap override -- Yes, distinct message including
        // the admin's reason." Unlike the calculated path, this is not
        // conditioned on the index actually differing from before:
        // handicap_overrides is itself deliberately append-only/always-
        // writes regardless of value (ghs#10), and the trigger table
        // doesn't qualify this row with "if changed" the way it does for
        // the calculated path.
        await notifications.record(
          {
            playerId: override.playerId,
            eventType: "manual_override",
            payload: { overrideId: override.id, previousIndex: override.previousIndex, newIndex: override.newIndex, reason: override.reason, adminUserId: override.adminUserId },
          },
          client,
        );

        await client.query("COMMIT");
        return override;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async listOverridesForPlayer(playerId) {
      return repository.listForPlayer(playerId);
    },
  };
}
