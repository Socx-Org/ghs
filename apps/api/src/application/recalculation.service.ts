import type { Logger } from "../logger.ts";
import type { RoundsRepository } from "../data/rounds.repository.ts";
import type { DailyPcc } from "../data/pcc.repository.ts";
import type { PccService } from "./pcc.service.ts";
import type { HandicapHistoryService } from "./handicap-history.service.ts";
import { applyWhsCaps, calculateHandicapIndex } from "./whs-calculation.ts";

// The single recalculation-orchestration boundary (ghs#24). Legacy calls
// its recalculation function independently from five separate route
// handlers, with inconsistent error handling between them (rejection's
// call never actually happens at all -- ghs#23's bug fix). Every trigger
// that can invalidate or establish a player's handicap goes through one
// of the two operations here instead -- no recalculation logic is ever
// duplicated at a call site.

export type RecalculationTrigger =
  | "round_approved"
  | "round_rejected"
  | "round_deleted"
  | "amendment_reopened"
  | "amendment_approved"
  | "pcc_correction";

export interface RecalculationOutcome {
  playerId: string;
  trigger: RecalculationTrigger;
  status: "eligible" | "insufficient_holes" | "insufficient_rounds" | "player_not_found" | "failed";
  handicapIndex?: number;
  // null when a real calculation ran but produced no change (a genuine
  // no-op -- ghs#21's change-only history policy), undefined when
  // status isn't "eligible" at all.
  historyRecordId?: string | null;
  error?: string;
}

export interface PccCorrectionOutcome {
  dailyPcc: DailyPcc;
  updatedRounds: number;
  playerRecalculations: RecalculationOutcome[];
}

export interface RecalculationOrchestrator {
  // Recomputes eligibility/selection/caps from the player's current
  // approved rounds (ghs#22), and -- only if the resulting index
  // actually changed -- writes a handicap_history row and updates
  // players.handicap_index/low_handicap_index (ghs#21's shared write
  // path). The round read happens before handicap-history's own write
  // transaction, the same shape already established by
  // PccService.calculateOrOverride (ghs#19) -- not a new pattern.
  recalculatePlayerHandicap(playerId: string, trigger: RecalculationTrigger): Promise<RecalculationOutcome>;

  // Recalculates PCC for a tee-configuration/day (ghs#19's atomic
  // upsert-and-bulk-rewrite), then recalculates every distinctly
  // affected player's handicap independently -- one transaction per
  // player, not one giant transaction for all of them, so a single
  // player's failure can never block or roll back another player's
  // already-correct recalculation from the same PCC correction.
  recalculatePccForTeeConfigDay(
    teeConfigurationId: string,
    playedOnRaw: string,
    pccOverride: number | null,
    actorUserId: string | null,
  ): Promise<PccCorrectionOutcome>;
}

export function createRecalculationOrchestrator(
  rounds: RoundsRepository,
  handicapHistory: HandicapHistoryService,
  pcc: PccService,
  logger: Logger,
): RecalculationOrchestrator {
  async function recalculatePlayerHandicap(playerId: string, trigger: RecalculationTrigger): Promise<RecalculationOutcome> {
    try {
      const current = await handicapHistory.getCurrentIndex(playerId);
      if (current === null) {
        return { playerId, trigger, status: "player_not_found" };
      }

      const differentials = await rounds.listApprovedDifferentialsForPlayer(playerId);
      const outcome = calculateHandicapIndex(differentials);

      if (outcome.status !== "eligible") {
        return { playerId, trigger, status: outcome.status };
      }

      const capApplication = applyWhsCaps(outcome.selection.rawHandicapIndex, current.lowHandicapIndex);

      const snapshot = {
        trigger,
        roundsConsidered: outcome.selection.roundsConsidered,
        countUsed: outcome.selection.countUsed,
        adjustment: outcome.selection.adjustment,
        differentialsUsed: outcome.selection.selected.map((d) => d.value),
        roundIdsUsed: outcome.selection.selected.flatMap((d) => d.roundIds),
        averageDifferential: outcome.selection.averageDifferential,
        multiplier: outcome.selection.multiplier,
        rawHandicapIndex: capApplication.rawHandicapIndex,
        appliedHandicapIndex: capApplication.appliedHandicapIndex,
        softCapTriggered: capApplication.softCapTriggered,
        hardCapTriggered: capApplication.hardCapTriggered,
        softCapThreshold: capApplication.softCapThreshold,
        hardCapThreshold: capApplication.hardCapThreshold,
        lowHandicapIndexUsed: capApplication.lowHandicapIndexUsed,
      };

      const result = await handicapHistory.recordCalculatedResult(
        playerId,
        capApplication.appliedHandicapIndex,
        new Date().toISOString(),
        snapshot,
      );

      return {
        playerId,
        trigger,
        status: "eligible",
        handicapIndex: result.handicapIndex,
        historyRecordId: result.history?.id ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("handicap recalculation failed", { playerId, trigger, error: message });
      return { playerId, trigger, status: "failed", error: message };
    }
  }

  return {
    recalculatePlayerHandicap,

    async recalculatePccForTeeConfigDay(teeConfigurationId, playedOnRaw, pccOverride, actorUserId) {
      const { dailyPcc, updatedRounds, affectedPlayerIds } = await pcc.calculateOrOverride(
        teeConfigurationId,
        playedOnRaw,
        pccOverride,
        actorUserId,
      );

      // Each player's recalculation is awaited in its own turn, but each
      // is independently transactional (recalculatePlayerHandicap above
      // already catches its own errors and never throws) -- one
      // player's failure is recorded in its own outcome and does not
      // prevent the remaining players from being processed or their
      // results from committing.
      const playerRecalculations: RecalculationOutcome[] = [];
      for (const playerId of affectedPlayerIds) {
        playerRecalculations.push(await recalculatePlayerHandicap(playerId, "pcc_correction"));
      }

      return { dailyPcc, updatedRounds, playerRecalculations };
    },
  };
}
