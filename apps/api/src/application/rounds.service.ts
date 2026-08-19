import type { Pool, PoolClient } from "pg";
import type {
  CreateHoleScoreInput,
  CreateRoundInput,
  HoleScore,
  PendingRoundQueueItem,
  Round,
  RoundForUpdate,
  RoundScoreUpdate,
  RoundsRepository,
  RoundStatus,
  RoundSummary,
} from "../data/rounds.repository.ts";
import type { CoursesRepository } from "../data/courses.repository.ts";
import type { ScoringService } from "./scoring.service.ts";
import type { RecalculationOrchestrator, RecalculationOutcome } from "./recalculation.service.ts";
import type { NotificationEventType, NotificationsRepository, RecordNotificationOptions } from "../data/notifications.repository.ts";
import type { PlayersRepository } from "../data/players.repository.ts";
import type { SystemSettingsService } from "./system-settings.service.ts";
import type { Logger } from "../logger.ts";

export class RoundNotFoundError extends Error {}
export class InvalidRoundTransitionError extends Error {}
// ghs#92: submitForReview's completeness check -- 004_rounds_and_
// scoring.sql's own file header explicitly deferred this ("Completeness-
// before-submission belongs to Phase 2's workflow, not this schema"),
// this is that moment.
export class IncompleteRoundError extends Error {}

export interface RoundWorkflowResult {
  // null only after deleteRound: a soft-deleted round is, by the same
  // deleted_at IS NULL filter every other read already applies,
  // immediately invisible to repository.get() -- there is no post-delete
  // round to return, so null communicates that rather than the deletion
  // being misreported as "not found" (a real bug caught while testing
  // this).
  round: Round | null;
  // null when no recalculation was warranted at all (reject/delete on a
  // round that never had a differential in the first place) --
  // undefined never appears here, only null, so callers don't have to
  // distinguish "not attempted" from "not applicable".
  recalculation: RecalculationOutcome | null;
}

export interface RoundsService {
  createRound(input: CreateRoundInput): Promise<Round>;
  // preloadedRound: callers that already have the round (e.g. the HTTP
  // route, which fetches it for its own authorization check) can pass it
  // through to skip a second, redundant repository.get() here. Omitted,
  // it's fetched as before -- existing callers are unaffected (caught in
  // review, PR #27).
  addHoleScore(roundId: string, input: CreateHoleScoreInput, preloadedRound?: Round): Promise<HoleScore>;
  // Not exposed over HTTP in this issue -- computing these values is
  // Phase 2's WHS calculation logic. Exists so the repository layer isn't
  // write-only-by-nobody for columns this schema already has.
  updateScores(id: string, update: RoundScoreUpdate): Promise<Round>;
  getRound(id: string): Promise<Round | null>;
  listRoundsForPlayer(playerId: string): Promise<RoundSummary[]>;
  // ghs#61: the admin pending-review queue, across all players -- a thin
  // pass-through to the repository's own purpose-built query. No
  // business logic belongs here (unlike the workflow transitions below),
  // so no wrapping beyond the interface/application layering ADR-060
  // already requires of every route.
  listPendingQueue(): Promise<PendingRoundQueueItem[]>;

  // draft|rejected|amending -> pending (ghs#58). The explicit moment a
  // round actually becomes visible to the admin pending-queue -- never
  // reachable by merely creating or editing one. Fires round_submitted
  // here, not at creation (ADR-210 point 1: the same transaction as the
  // real event, and "submitted" now genuinely means "asked for review",
  // not "record exists"). No recalculation: none of draft/rejected/
  // amending ever contributed a differential (only 'approved' rounds do,
  // per listApprovedDifferentialsForPlayer), so landing in 'pending'
  // changes nothing recalculation needs to see yet -- approveRound is
  // still what triggers that, unchanged.
  submitForReview(id: string): Promise<RoundWorkflowResult>;

  // Every method below is a real workflow transition (ghs#23): each
  // opens its own transaction, locks the round row first
  // (RoundsRepository.getForUpdate), validates the transition is legal
  // from the round's current status, applies the state change, and --
  // through the SAME transaction/client -- calls the recalculation
  // orchestrator (ghs#24) so the state change and its recalculation
  // commit or roll back together. No recalculation logic is duplicated
  // here; this layer only decides *which* trigger applies and *whether*
  // to attempt one at all.

  // pending|amending -> approved. Always recalculates (a newly-approved
  // round is expected to matter to the player's handicap; if it turns
  // out not to yet -- insufficient_holes -- that's still a real,
  // reported outcome, not something to skip). Re-scoring
  // (ScoringService.recomputeRoundAggregates) runs first, as its own
  // preliminary step -- see the file-level note below on why that isn't
  // inside the same transaction as the status change.
  approveRound(id: string): Promise<RoundWorkflowResult>;

  // pending|amending -> rejected, mandatory reason. Fixes the confirmed
  // legacy bug: rejecting a round that had already contributed a
  // differential (i.e. was previously approved, then reopened, then
  // rejected instead of re-approved) now actually recalculates -- legacy
  // only logged that it should have.
  rejectRound(id: string, reason: string): Promise<RoundWorkflowResult>;

  // Soft delete, any status. Recalculates only if the round had a real
  // differential (matches the same "did this round ever actually
  // contribute" check rejectRound uses).
  deleteRound(id: string): Promise<RoundWorkflowResult>;

  // approved -> amending, mandatory reason. The round is excluded from
  // the player's effective differentials the moment its status changes
  // (RoundsRepository.listApprovedDifferentialsForPlayer only ever reads
  // status='approved') -- no separate "retraction" step is needed here,
  // recalculating after the status change picks it up automatically.
  // Never notifies (platform owner decision, Phase 2 planning,
  // 2026-08-12) -- ghs#25's concern, not enforced here, just not
  // triggered here either.
  reopenForAmendment(id: string, reason: string): Promise<RoundWorkflowResult>;
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
  pool: Pool,
  repository: RoundsRepository,
  courses: CoursesRepository,
  scoring: ScoringService,
  recalculation: RecalculationOrchestrator,
  notifications: NotificationsRepository,
  players: PlayersRepository,
  systemSettings: SystemSettingsService,
  logger: Logger,
): RoundsService {
  // notification_history/notification_outbox are user_id-scoped, not
  // player_id-scoped (ghs#39) -- every real recipient is fundamentally a
  // user, and not every player has one (an admin can enter a round for a
  // player who never registered). Skips, doesn't error, when the player
  // has no linked user account: there is no email address anywhere for
  // such a player (Player has no email field of its own, only
  // users.email), so there is genuinely nothing to notify.
  async function notifyPlayer(
    playerId: string,
    eventType: NotificationEventType,
    payload: Record<string, unknown>,
    client: PoolClient,
    options?: RecordNotificationOptions,
  ): Promise<void> {
    const player = await players.get(playerId);
    if (!player?.userId) return;
    await notifications.record({ userId: player.userId, eventType, payload }, client, options);
  }
  // recomputeRoundAggregates runs as its own, separate step before the
  // approval transaction opens -- not threaded into the same client. This
  // mirrors the precedent PccService.calculateOrOverride (ghs#19) already
  // set (reading round inputs outside its own bulk-update transaction):
  // an admin-driven, low-concurrency workflow, where the cost of fully
  // threading a client through ScoringService's own chain of repository
  // calls (RoundsRepository.get, CoursesRepository.getTeeConfiguration,
  // PccService.getOrCreateDailyPcc, RoundsRepository.updateScores) would
  // be real, ongoing complexity for a race window that's already
  // acceptably small in practice. The genuinely atomic unit -- state
  // transition + recalculation -- is what Issue 23/24's acceptance
  // criteria actually requires, and that part is fully transactional
  // below.
  async function rescoreBeforeApproval(roundId: string): Promise<void> {
    await scoring.recomputeRoundAggregates(roundId);
  }

  // Shared by approveRound's pre-rescore check and runWorkflowTransition's
  // own locked validate() below -- both need to reject the exact same set
  // of statuses with the exact same message.
  function assertApprovableStatus(status: RoundStatus): void {
    if (status !== "pending" && status !== "amending") {
      throw new InvalidRoundTransitionError(`cannot approve a round in status '${status}'`);
    }
  }

  // ghs#58: the set of statuses a player may still write hole scores
  // into, and the exact same set submitForReview accepts as a valid
  // source status -- one shared definition, not two independently
  // maintained lists that could drift apart.
  function isEditableStatus(status: RoundStatus): boolean {
    return status === "draft" || status === "rejected" || status === "amending";
  }

  async function runWorkflowTransition(
    id: string,
    validate: (existing: RoundForUpdate) => void,
    apply: (client: PoolClient, existing: RoundForUpdate) => Promise<RecalculationOutcome | null>,
  ): Promise<RoundWorkflowResult> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await repository.getForUpdate(id, client);
      if (!existing) throw new RoundNotFoundError(`round ${id} not found`);
      validate(existing);

      const recalculationResult = await apply(client, existing);

      await client.query("COMMIT");

      // null after deleteRound (the round is now correctly invisible to
      // this same filtered read) -- not an error condition, see
      // RoundWorkflowResult.round's own comment.
      const round = await repository.get(id);
      return { round, recalculation: recalculationResult };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

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

      // ghs#58: creating a round no longer submits it for review -- it
      // lands in 'draft' (repository.create's own insert), invisible to
      // the admin pending-queue. No round_submitted notification here
      // any more (moved to submitForReview below, ADR-210 point 1's
      // "same transaction as the real event" now means the same
      // transaction as the SUBMISSION, not mere record creation) -- so
      // this no longer needs its own transaction wrapper either;
      // repository.create() manages its own, exactly as it did before
      // ghs#25 threaded a client through for the notification's sake.
      const round = await repository.create({ ...input, holeScores });
      logger.info("round created", { roundId: round.id, playerId: round.playerId, holeCount: round.holeScores.length });
      return round;
    },

    async addHoleScore(roundId, input, preloadedRound) {
      const round = (preloadedRound && preloadedRound.id === roundId) ? preloadedRound : await repository.get(roundId);
      if (!round) throw new Error("round not found");

      const teeConfiguration = await courses.getTeeConfiguration(round.teeConfigurationId);
      if (!teeConfiguration) throw new Error("tee configuration not found");

      // playingHandicap and the tee configuration's own hole data never
      // change after a round/course is created (no edit path exists for
      // either), so computing this from the caller's own round snapshot
      // is safe even though that snapshot's STATUS may be stale -- unlike
      // status, this doesn't need the fresh, locked read below.
      const netDoubleBogeyAdjusted = scoring.computeHoleAdjustment({
        holeNumber: input.holeNumber,
        strokes: input.strokes,
        playingHandicap: round.playingHandicap ?? 0,
        holes: teeConfiguration.holes,
        holeCount: teeConfiguration.holeCount,
      });

      // ghs#58: the actual editable-status decision is made against a
      // freshly row-locked read, not the caller's (possibly stale)
      // snapshot -- preloadedRound in particular may be minutes old by
      // the time this runs (the HTTP route fetches it once, up front,
      // for its own ownership check). Locking + checking + inserting on
      // the SAME transaction closes the race a concurrent submit/admin
      // transition could otherwise slip through between the check and
      // the write -- the same FOR UPDATE discipline runWorkflowTransition
      // already gives every other status-sensitive round operation in
      // this file, found missing here in review (PR #73).
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await repository.getForUpdate(roundId, client);
        if (!locked) throw new RoundNotFoundError(`round ${roundId} not found`);
        if (!isEditableStatus(locked.status)) {
          throw new InvalidRoundTransitionError(`cannot add a hole score to a round in status '${locked.status}'`);
        }
        const holeScore = await repository.addHoleScore(roundId, { ...input, netDoubleBogeyAdjusted }, client);
        await client.query("COMMIT");
        logger.info("hole score recorded", { roundId, holeNumber: holeScore.holeNumber });
        return holeScore;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Best-effort only, same convention as apply.ts's advisory
          // unlock / migration rollback -- never let a secondary
          // rollback failure replace and hide the real error above.
        }
        throw err;
      } finally {
        client.release();
      }
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

    async listPendingQueue() {
      return repository.listPendingQueue();
    },

    async submitForReview(id) {
      const { roundSubmitted } = await systemSettings.getNotificationSettings();

      return runWorkflowTransition(
        id,
        (existing) => {
          if (!isEditableStatus(existing.status)) {
            throw new InvalidRoundTransitionError(`cannot submit a round in status '${existing.status}' for review`);
          }
        },
        async (client, existing) => {
          // ghs#92: completeness check, run inside the same locked
          // transaction as the status change itself -- a round is
          // "complete" when every hole its tee configuration actually
          // defines has a recorded score, except for an is9Hole round,
          // where the schema has no way to record which specific 9 hole
          // numbers were intended (no front-9/back-9 field anywhere,
          // and is_9_hole/tee_configurations.hole_count are independent,
          // unconstrained columns -- confirmed against every real test
          // fixture, none pairs is9Hole with a 9-hole tee configuration)
          // -- so "at least 9 distinct scores" is the most precise rule
          // the current schema can express for that case.
          const teeConfiguration = await courses.getTeeConfiguration(existing.teeConfigurationId);
          if (!teeConfiguration) throw new Error("tee configuration not found");
          const recordedCount = await repository.countHoleScores(id, client);
          const requiredCount = existing.is9Hole ? 9 : teeConfiguration.holes.length;
          if (recordedCount < requiredCount) {
            throw new IncompleteRoundError(
              `round has ${recordedCount} of ${requiredCount} required hole scores recorded`,
            );
          }

          // setStatus's rejectionReason param defaults to null when
          // omitted (same as approveRound/reopenForAmendment below) --
          // clears a stale rejection reason from a round that's now
          // back under review, the same way those two already clear it
          // implicitly today.
          await repository.setStatus(id, "pending", undefined, client);
          // notification_history always gets a row -- the round was
          // genuinely submitted regardless of preference -- but no
          // outbox row (nothing for the worker to ever deliver) when
          // gated off (ghs#41, ADR-210's "history without outbox" case).
          await notifyPlayer(
            existing.playerId,
            "round_submitted",
            { roundId: id, teeConfigurationId: existing.teeConfigurationId, playedAt: existing.playedAt },
            client,
            { enqueue: roundSubmitted },
          );
          logger.info("round submitted for review", { roundId: id, playerId: existing.playerId });
          return null;
        },
      );
    },

    async approveRound(id) {
      // Checked before rescoring, not left to surface from inside it:
      // without this, a missing round would throw ScoringService's generic
      // "round not found" Error instead of RoundNotFoundError (500 instead
      // of 404), and a round in a non-approvable status would still have
      // rescoreBeforeApproval persist new score/differential values via
      // recomputeRoundAggregates before the transition below ever gets a
      // chance to reject it -- a real, unwanted side effect on a call that
      // ultimately fails (caught in review, PR #32).
      const existing = await repository.get(id);
      if (!existing) throw new RoundNotFoundError(`round ${id} not found`);
      assertApprovableStatus(existing.status);

      await rescoreBeforeApproval(id);

      const { roundApproved } = await systemSettings.getNotificationSettings();

      return runWorkflowTransition(
        id,
        // Re-checked here too, under the row lock: the status above was
        // read outside any transaction, so it could in principle have
        // changed between that check and this one (e.g. a concurrent
        // reject) -- this is the authoritative check.
        (existing) => assertApprovableStatus(existing.status),
        async (client, existing) => {
          const trigger = existing.status === "amending" ? "amendment_approved" : "round_approved";
          await repository.setStatus(id, "approved", undefined, client);
          // Notification event_type is always "round_approved", even for
          // an amendment re-approval -- "same as ordinary approval", per
          // ghs#25's own domain trigger table. The recalculation trigger
          // tag (amendment_approved vs round_approved) still distinguishes
          // them internally, just not in what the player is told.
          // enqueue: same gating as createRound above (ghs#41).
          await notifyPlayer(existing.playerId, "round_approved", { roundId: id, trigger }, client, { enqueue: roundApproved });
          const result = await recalculation.recalculatePlayerHandicap(existing.playerId, trigger, client);
          logger.info("round approved", { roundId: id, playerId: existing.playerId, trigger, recalculationStatus: result.status });
          return result;
        },
      );
    },

    async rejectRound(id, reason) {
      const trimmedReason = reason.trim();
      if (!trimmedReason) {
        throw new InvalidRoundTransitionError("rejectionReason is required");
      }

      return runWorkflowTransition(
        id,
        (existing) => {
          if (existing.status !== "pending" && existing.status !== "amending") {
            throw new InvalidRoundTransitionError(`cannot reject a round in status '${existing.status}'`);
          }
        },
        async (client, existing) => {
          await repository.setStatus(id, "rejected", trimmedReason, client);
          // Always fires, including the mandatory reason (ghs#25's own
          // domain trigger table) -- unlike recalculation below, this is
          // not conditioned on the round having ever had a differential:
          // rejecting IS the business event regardless of whether there
          // was anything to recalculate as a result.
          await notifyPlayer(existing.playerId, "round_rejected", { roundId: id, reason: trimmedReason }, client);
          // Legacy bug fix: only logged as "requested", never actually
          // recalculated, when rejecting a round that had already
          // contributed a differential (ghs#23's own confirmed finding).
          if (existing.scoreDifferential === null) {
            logger.info("round rejected", { roundId: id, playerId: existing.playerId, recalculation: "not applicable -- round never had a differential" });
            return null;
          }
          const result = await recalculation.recalculatePlayerHandicap(existing.playerId, "round_rejected", client);
          logger.info("round rejected", { roundId: id, playerId: existing.playerId, recalculationStatus: result.status });
          return result;
        },
      );
    },

    async deleteRound(id) {
      return runWorkflowTransition(
        id,
        () => { /* deletion is allowed from any status */ },
        async (client, existing) => {
          await repository.softDelete(id, client);
          if (existing.scoreDifferential === null) {
            logger.info("round deleted", { roundId: id, playerId: existing.playerId, recalculation: "not applicable -- round never had a differential" });
            return null;
          }
          const result = await recalculation.recalculatePlayerHandicap(existing.playerId, "round_deleted", client);
          logger.info("round deleted", { roundId: id, playerId: existing.playerId, recalculationStatus: result.status });
          return result;
        },
      );
    },

    async reopenForAmendment(id, reason) {
      const trimmedReason = reason.trim();
      if (!trimmedReason) {
        throw new InvalidRoundTransitionError("reason is required to reopen a round for amendment");
      }

      const result = await runWorkflowTransition(
        id,
        (existing) => {
          if (existing.status !== "approved") {
            throw new InvalidRoundTransitionError(
              `only an approved round can be reopened for amendment (current status: '${existing.status}')`,
            );
          }
        },
        async (client, existing) => {
          await repository.setStatus(id, "amending", undefined, client);
          const recalcResult = await recalculation.recalculatePlayerHandicap(existing.playerId, "amendment_reopened", client);
          logger.info("round reopened for amendment", { roundId: id, playerId: existing.playerId, reason: trimmedReason, recalculationStatus: recalcResult.status });
          return recalcResult;
        },
      );

      // No notification on reopen (platform owner decision, Phase 2
      // planning, 2026-08-12) -- nothing to do here; this comment exists
      // so the absence reads as deliberate, not an oversight, for
      // whoever wires ghs#25's triggers against this method later.
      return result;
    },
  };
}
