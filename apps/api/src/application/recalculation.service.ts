import type { Pool, PoolClient } from "pg";
import type { Logger } from "../logger.ts";
import type { RoundsRepository } from "../data/rounds.repository.ts";
import type { DailyPcc } from "../data/pcc.repository.ts";
import type { PccService } from "./pcc.service.ts";
import type { HandicapHistoryService } from "./handicap-history.service.ts";
import type { NotificationsRepository } from "../data/notifications.repository.ts";
import type { PlayersRepository } from "../data/players.repository.ts";
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
  // path). The player row is locked (SELECT ... FOR UPDATE) from the
  // very first read, so the Low Handicap Index used for cap application
  // is guaranteed consistent with whatever gets written -- not a value
  // that could have changed in between (caught in review, PR #31).
  //
  // client: two distinct modes, not just a performance optimisation --
  //   - Omitted (self-managed): this method opens its own connection and
  //     a real transaction spanning the entire read -> compute -> write
  //     sequence (not just the final write), commits on success, rolls
  //     back and reports a "failed" outcome on error. Used by
  //     recalculatePccForTeeConfigDay below, where each affected player
  //     is deliberately independent of the others.
  //   - Provided (caller-managed): every read/write runs on the given
  //     client, no transaction is opened or committed here, and errors
  //     PROPAGATE (are not caught) so the caller's own transaction can
  //     roll back. This is what lets ghs#23's round-approval/rejection/
  //     amendment handlers bundle "update rounds.status" and "recalculate
  //     this player's handicap" into one real, atomic commit.
  recalculatePlayerHandicap(
    playerId: string,
    trigger: RecalculationTrigger,
    client?: PoolClient,
  ): Promise<RecalculationOutcome>;

  // Recalculates PCC for a tee-configuration/day (ghs#19's atomic
  // upsert-and-bulk-rewrite), then recalculates every distinctly
  // affected player's handicap independently -- one real transaction per
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
  pool: Pool,
  rounds: RoundsRepository,
  handicapHistory: HandicapHistoryService,
  pcc: PccService,
  notifications: NotificationsRepository,
  players: PlayersRepository,
  logger: Logger,
): RecalculationOrchestrator {
  // Runs entirely on the given client -- every read and the eventual
  // write are all part of whatever transaction that client belongs to.
  // No BEGIN/COMMIT/ROLLBACK here; the caller (either
  // recalculatePlayerHandicap's own self-managed wrapper below, or an
  // external caller) owns that.
  async function runRecalculation(playerId: string, trigger: RecalculationTrigger, client: PoolClient): Promise<RecalculationOutcome> {
    // Locked from this first read, not just at the final write -- the
    // Low Handicap Index used for cap application below is guaranteed
    // consistent with whatever recordCalculatedResult later writes,
    // because no other transaction can modify this row until this one
    // commits or rolls back.
    const current = await handicapHistory.getCurrentIndexForUpdate(playerId, client);
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

    // "Handicap changed (calculated), index actually changed" -- ghs#25's
    // domain trigger table. Centralised here rather than at every
    // recalculation call site (round approve/reject/delete, PCC
    // correction) for the same reason recalculation logic itself isn't
    // duplicated at those call sites: this is the one place that
    // authoritatively knows both "did the index actually change"
    // (result.history !== null -- ghs#21's own change-only write policy)
    // and the trigger. amendment_reopened is the one explicit exclusion
    // (platform owner decision, 2026-08-12): the player isn't told
    // anything about a reopened round, including a transient handicap
    // change caused by retracting it, until the correction is finalised.
    if (result.history !== null && trigger !== "amendment_reopened") {
      // user_id, not player_id (ghs#39) -- skip, don't error, when this
      // player has no linked user account (see notifications.
      // repository.ts's own comment for the full reasoning).
      const player = await players.get(playerId);
      if (player?.userId) {
        await notifications.record(
          {
            userId: player.userId,
            eventType: "handicap_changed",
            payload: { trigger, previousIndex: current.handicapIndex, newIndex: result.handicapIndex, historyRecordId: result.history.id },
          },
          client,
        );
      }
    }

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
    externalClient?: PoolClient,
  ): Promise<RecalculationOutcome> {
    if (externalClient) {
      // Caller-managed: let errors propagate so the caller's own
      // transaction rolls back instead of committing a state change
      // whose recalculation silently failed.
      return runRecalculation(playerId, trigger, externalClient);
    }

    // Self-managed: this call owns a real, single transaction spanning
    // the entire read -> compute -> write sequence -- not just the final
    // write (caught in review, PR #31: an earlier version of this method
    // read via the plain pool with no lock at all, then only the very
    // last write step was transactional/locked, leaving a real race
    // window and letting cap application use a Low Handicap Index that
    // could already be stale by the time it was read).
    const ownClient = await pool.connect();
    try {
      await ownClient.query("BEGIN");
      const result = await runRecalculation(playerId, trigger, ownClient);
      await ownClient.query("COMMIT");
      return result;
    } catch (err) {
      await ownClient.query("ROLLBACK");
      const message = err instanceof Error ? err.message : String(err);
      logger.error("handicap recalculation failed", { playerId, trigger, error: message });
      return { playerId, trigger, status: "failed", error: message };
    } finally {
      ownClient.release();
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
      // its own independent, real transaction, its own caught errors.
      // One player's failure is recorded in its own outcome and does not
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
