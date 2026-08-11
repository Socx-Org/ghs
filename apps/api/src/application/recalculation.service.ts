import type { PoolClient } from "pg";
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
  // path).
  //
  // client: two distinct modes, not just a performance optimisation --
  //   - Omitted (self-managed): every read/write here runs in its own
  //     connection, and any error is caught and reported as a "failed"
  //     outcome rather than thrown. Used by recalculatePccForTeeConfigDay
  //     below, where each affected player is deliberately independent.
  //   - Provided (caller-managed): every read/write runs on the given
  //     client, no transaction is opened or committed here, and errors
  //     PROPAGATE (are not caught) so the caller's own transaction can
  //     roll back. This is what lets ghs#23's round-approval/rejection/
  //     amendment handlers bundle "update rounds.status" and "recalculate
  //     this player's handicap" into one real, atomic commit -- exactly
  //     what Issue 24's own acceptance criteria requires and what an
  //     earlier version of this orchestrator could not actually do
  //     (caught in review, PR #31: there was no way for a caller to
  //     participate in this method's transaction at all).
  recalculatePlayerHandicap(
    playerId: string,
    trigger: RecalculationTrigger,
    client?: PoolClient,
  ): Promise<RecalculationOutcome>;

  // Recalculates PCC for a tee-configuration/day (ghs#19's atomic
  // upsert-and-bulk-rewrite), then recalculates every distinctly
  // affected player's handicap independently -- one transaction per
  // player (self-managed mode, above), not one giant transaction for all
  // of them, so a single player's failure can never block or roll back
  // another player's already-correct recalculation from the same PCC
  // correction.
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
  async function runRecalculation(playerId: string, trigger: RecalculationTrigger, client: PoolClient | undefined): Promise<RecalculationOutcome> {
    const current = await handicapHistory.getCurrentIndex(playerId, client);
    if (current === null) {
      return { playerId, trigger, status: "player_not_found" };
    }

    const differentials = await rounds.listApprovedDifferentialsForPlayer(playerId, client);
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
      client,
    );

    return {
      playerId,
      trigger,
      status: "eligible",
      handicapIndex: result.handicapIndex,
      historyRecordId: result.history?.id ?? null,
    };
  }

  async function recalculatePlayerHandicap(
    playerId: string,
    trigger: RecalculationTrigger,
    client?: PoolClient,
  ): Promise<RecalculationOutcome> {
    if (client) {
      // Caller-managed: let errors propagate so the caller's own
      // transaction rolls back instead of committing a state change
      // whose recalculation silently failed.
      return runRecalculation(playerId, trigger, client);
    }

    try {
      return await runRecalculation(playerId, trigger, undefined);
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

      // Each player is recalculated in self-managed mode (no client) --
      // its own independent transaction, its own caught errors. One
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
