import type { Pool, PoolClient } from "pg";
import type {
  CreateHoleScoreInput,
  CreateRoundInput,
  HoleScore,
  ListAdminRoundsFilter,
  ListAdminRoundsResult,
  PendingRoundQueueItem,
  PlayerRoundListItem,
  Round,
  RoundForUpdate,
  RoundScoreUpdate,
  RoundsRepository,
  RoundStatus,
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
  listRoundsForPlayer(playerId: string): Promise<PlayerRoundListItem[]>;
  // ghs#61: the admin pending-review queue, across all players -- a thin
  // pass-through to the repository's own purpose-built query. No
  // business logic belongs here (unlike the workflow transitions below),
  // so no wrapping beyond the interface/application layering ADR-060
  // already requires of every route.
  listPendingQueue(): Promise<PendingRoundQueueItem[]>;
  // ghs#100/#113: the general admin all-rounds browser -- same thin
  // pass-through reasoning as listPendingQueue above.
  listAdminRounds(filter: ListAdminRoundsFilter): Promise<ListAdminRoundsResult>;

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
  //
  // submittedByRole (ghs#100 review fix, PR #141): the ghs#100 fast path
  // below only ever auto-approves when the round was BOTH created by an
  // admin/super_admin AND is being submitted right now by an admin/
  // super_admin. createdByRole alone isn't enough -- it's a snapshot of
  // who created the round, not who is choosing to submit it, and a
  // player is permitted to edit/submit their own round's holes
  // (authorizeForPlayer) regardless of who originally drafted it. Without
  // this second check, a player could take over an admin-drafted round
  // and have their own submission silently skip review -- exactly the
  // gate this fast path must never bypass for a player's own action.
  submitForReview(id: string, submittedByRole: "player" | "admin" | "super_admin"): Promise<RoundWorkflowResult>;

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

  // Soft delete. Recalculates only if the round had a real differential
  // (matches the same "did this round ever actually contribute" check
  // rejectRound uses).
  //
  // callerRole (ghs#147, platform-owner decision): admin/super_admin
  // may delete a round in any status, unchanged. Anyone else -- a
  // "player", or any other value -- may only delete their own round
  // while it's still editable (draft/rejected/amending), never one
  // that's already pending/approved, since an approved round has
  // genuinely contributed to real handicap history and quietly
  // erasing it is a handicap-integrity question, not a UI detail.
  // Deliberately checked as "is this positively an admin?" rather than
  // "is this positively a player?" (review finding, PR #148) -- fails
  // closed (restricted) for any unexpected value, not open. The route
  // layer handles the ownership check (identity.sub === round.playerId);
  // this status restriction is enforced here, under the same lock as
  // every other authoritative status check in this file.
  deleteRound(id: string, callerRole: "player" | "admin" | "super_admin"): Promise<RoundWorkflowResult>;

  // approved -> amending, mandatory reason. The round is excluded from
  // the player's effective differentials the moment its status changes
  // (RoundsRepository.listApprovedDifferentialsForPlayer only ever reads
  // status='approved') -- no separate "retraction" step is needed here,
  // recalculating after the status change picks it up automatically.
  // Never notifies (platform owner decision, Phase 2 planning,
  // 2026-08-12) -- ghs#25's concern, not enforced here, just not
  // triggered here either.
  reopenForAmendment(id: string, reason: string): Promise<RoundWorkflowResult>;

  // ghs#169: draft/pending/rejected/amending only -- see
  // isDateEditableStatus's own comment for the full reasoning, including
  // why this doesn't copy deleteRound's admin-unrestricted-by-status
  // asymmetry. No recalculation is ever triggered here -- none of the
  // four eligible statuses carries a differential that currently counts
  // toward handicap calculation (an 'amending' round's own stale
  // score_differential/pcc from its prior approval is deliberately left
  // as-is here, same as a hole-score edit made during amending -- only
  // the next approval's own rescore picks up whatever played_at is
  // current at that point).
  updatePlayedAt(id: string, playedAt: string): Promise<RoundWorkflowResult>;
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
  // recomputeRoundAggregates runs as its own, separate step before
  // whichever locked transition follows it -- never threaded into the
  // same client. This mirrors the precedent PccService.calculateOrOverride
  // (ghs#19) already set (reading round inputs outside its own bulk-update
  // transaction): an admin-driven, low-concurrency workflow, where the
  // cost of fully threading a client through ScoringService's own chain
  // of repository calls (RoundsRepository.get, CoursesRepository.
  // getTeeConfiguration, PccService.getOrCreateDailyPcc, RoundsRepository.
  // updateScores) would be real, ongoing complexity for a race window
  // that's already acceptably small in practice. The genuinely atomic
  // unit -- state transition + recalculation -- is what the workflow's
  // own acceptance criteria actually requires, and that part is fully
  // transactional below.
  //
  // ghs#168: originally only called before approval (hence the old name,
  // rescoreBeforeApproval) -- now also called before an ordinary
  // submission and after a played-at edit on an already-scored round, so
  // renamed to describe what it does, not just its original one call
  // site. approveRoundInternal's own call is deliberately kept even
  // though a round submitted through the ordinary path is already
  // current by the time it reaches approval -- an 'amending' round is
  // re-approved directly (never re-submitted), so this is still the only
  // rescore that path ever gets. Redundant-but-harmless for the ordinary
  // pending -> approved path, genuinely necessary for amending -> approved.
  async function rescoreRound(roundId: string): Promise<void> {
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

  // ghs#169: deliberately broader than isEditableStatus above -- also
  // true for 'pending'. A wrong played date is a data-entry slip a
  // player should be able to self-correct without needing an admin to
  // reject the round first, unlike hole scores (which stay locked while
  // a round is under active review). The only status excluded is
  // 'approved', the only one a round's own score_differential is ever
  // read from for handicap calculation (RoundsRepository.
  // listApprovedDifferentialsForPlayer). Same boundary for a player and
  // an admin/super_admin caller alike -- unlike deleteRound's admin-
  // unrestricted-by-status precedent, changing an approved round's date
  // is "amend this round," which reopenForAmendment already exists to
  // do safely; this doesn't invent a second way to edit an approved
  // round directly.
  function isDateEditableStatus(status: RoundStatus): boolean {
    return status === "draft" || status === "pending" || status === "rejected" || status === "amending";
  }

  // ghs#168 review of every "scoreDifferential === null" assumption in
  // this file: rejectRound/deleteRound below used to treat a null
  // scoreDifferential as "this round never counted toward the player's
  // handicap, skip recalculating" -- a proxy that only worked because,
  // before this issue, the ONLY way a round got a real scoreDifferential
  // was approval itself. Now that submission also scores a round
  // (below), a merely-pending or since-rejected round has a real,
  // non-null scoreDifferential despite having never been approved --
  // the old proxy would trigger a wasted (though not incorrect --
  // recalculating the same already-approved set produces the identical
  // result) recalculation on every reject/delete of an ordinary
  // never-approved round. The real question was always "did this round
  // currently count, or previously count via approval" -- 'approved'
  // (currently does) or 'amending' (did, until reopened -- already
  // excluded from listApprovedDifferentialsForPlayer, but its exclusion
  // was itself a real recalculation-worthy event) -- not "does it happen
  // to have a number in this column."
  function everCountedTowardHandicap(status: RoundStatus): boolean {
    return status === "approved" || status === "amending";
  }

  // ghs#168: a round already scored at submission (pending) or since
  // rejected (still carrying that same submission-time score) must be
  // rescored if its played date changes, or the stored differential
  // would silently reflect the wrong day's PCC -- exactly the forward
  // interaction ghs#169 flagged before this issue existed to resolve it.
  // Deliberately excludes 'amending': that status's own stale
  // score/pcc-until-re-approval is an already-established, deliberate
  // exception (ghs#169), not something this issue revisits. Excludes
  // 'draft' too -- never scored yet, nothing to go stale.
  function needsRescoreAfterDateChange(status: RoundStatus): boolean {
    return status === "pending" || status === "rejected";
  }

  // ghs#92/#168: the completeness rule ("every hole the tee configuration
  // defines has a recorded score, or at least 9 for an is9Hole round")
  // now needs checking in three places -- the ordinary submission's own
  // lock-free pre-check (new, ghs#168, so an incomplete round is never
  // rescored as a side effect of an attempt that's about to fail
  // anyway -- same discipline PR #32 already established for
  // approveRoundInternal's status check), that same submission's
  // authoritative locked check, and submitAdminCreatedRound's identical
  // requirement -- one shared implementation instead of three
  // independently-drifting copies.
  async function assertCompleteForSubmission(
    round: { id: string; teeConfigurationId: string; is9Hole: boolean },
    client?: PoolClient,
  ): Promise<void> {
    const teeConfiguration = await courses.getTeeConfiguration(round.teeConfigurationId);
    if (!teeConfiguration) throw new Error("tee configuration not found");
    const recordedCount = await repository.countHoleScores(round.id, client);
    const requiredCount = round.is9Hole ? 9 : teeConfiguration.holes.length;
    if (recordedCount < requiredCount) {
      throw new IncompleteRoundError(`round has ${recordedCount} of ${requiredCount} required hole scores recorded`);
    }
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

  // Extracted from the returned object's approveRound below so
  // submitAdminCreatedRound (ghs#100) can reuse it verbatim, unchanged --
  // see that function's own doc comment for why.
  async function approveRoundInternal(id: string): Promise<RoundWorkflowResult> {
    // Checked before rescoring, not left to surface from inside it:
    // without this, a missing round would throw ScoringService's generic
    // "round not found" Error instead of RoundNotFoundError (500 instead
    // of 404), and a round in a non-approvable status would still have
    // rescoreRound persist new score/differential values via
    // recomputeRoundAggregates before the transition below ever gets a
    // chance to reject it -- a real, unwanted side effect on a call that
    // ultimately fails (caught in review, PR #32).
    const existing = await repository.get(id);
    if (!existing) throw new RoundNotFoundError(`round ${id} not found`);
    assertApprovableStatus(existing.status);

    await rescoreRound(id);

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
  }

  // ghs#100: an admin-created round (created_by_role, captured at
  // creation time -- migration 014) skips the pending queue entirely on
  // submit -- the admin themselves is the person of record entering
  // it, and an admin reviewing their own entry makes no sense.
  //
  // Review fix, PR #141: the completeness check and the actual approval
  // must not have an unlocked gap between them -- a round is still
  // editable (draft/rejected/amending) right up until its status
  // genuinely changes, so a naive "check completeness, rescore, then
  // lock-and-approve" sequence leaves a real window where a concurrent
  // addHoleScore (ghs#58, itself lock-checked) could slip in edits the
  // approval below would never see. Closing that window has to happen
  // under a lock, but ScoringService.recomputeRoundAggregates can't run
  // inside one (it always opens its own connection -- see
  // rescoreBeforeApproval's own comment) -- so instead of trying to
  // combine both under one lock, this reuses the two already-safe,
  // already-tested primitives in sequence: first, a quiet (no
  // notification -- this is an internal implementation step, not a
  // real "submitted for review" event a player should be told about)
  // locked transition straight to 'pending', with the SAME completeness
  // check submitForReview's ordinary path runs at that exact same
  // transition point; then approveRoundInternal, completely unchanged,
  // exactly as a human admin approving a real pending round would
  // trigger it. The instant the quiet transition commits,
  // addHoleScore's own lock-checked isEditableStatus rejects any
  // further edit -- the same guarantee the ordinary pending->approved
  // path has always relied on, now genuinely held here too.
  async function submitAdminCreatedRound(id: string): Promise<RoundWorkflowResult> {
    await runWorkflowTransition(
      id,
      (existing) => {
        if (!isEditableStatus(existing.status)) {
          throw new InvalidRoundTransitionError(`cannot submit a round in status '${existing.status}' for review`);
        }
      },
      async (client, existing) => {
        await assertCompleteForSubmission(existing, client);
        await repository.setStatus(id, "pending", undefined, client);
        return null;
      },
    );

    // ghs#168: deliberately doesn't rescore here too -- approveRoundInternal,
    // called immediately below with no observable gap in between, already
    // does. This round is never visibly "pending" to anything (an admin,
    // a Daily PCC calculation) between the two calls, so there's no real
    // window submission-time scoring needs to unblock for this fast path
    // the way there is for the ordinary player-submission path below.
    return approveRoundInternal(id);
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

    async listAdminRounds(filter) {
      return repository.listAdminRounds(filter);
    },

    async submitForReview(id, submittedByRole) {
      // ghs#100: a lightweight, lock-free read used only to decide
      // which path applies, before any transaction opens -- not a
      // substitute for either path's own getForUpdate/get read, which
      // still re-validates everything for real. A nonexistent round
      // (createdByRole comes back null either way) is still caught
      // correctly by whichever path runs next, so this doesn't need its
      // own not-found handling.
      const createdByRole = await repository.getCreatedByRole(id);
      const isAdminCreated = createdByRole === "admin" || createdByRole === "super_admin";
      // Review fix, PR #141: both conditions must hold -- see this
      // method's own interface doc comment for why createdByRole alone
      // isn't a safe enough signal on its own.
      const isAdminSubmitting = submittedByRole === "admin" || submittedByRole === "super_admin";
      if (isAdminCreated && isAdminSubmitting) {
        return submitAdminCreatedRound(id);
      }

      // ghs#168: status + completeness checked BEFORE the locked
      // transition below opens -- avoids uselessly opening a transaction
      // for an attempt that's obviously going to fail (same reasoning as
      // approveRoundInternal's own pre-check, PR #32). Read-only, so no
      // race to worry about here -- unlike rescoring (see below), this
      // doesn't mutate anything.
      const existing = await repository.get(id);
      if (!existing) throw new RoundNotFoundError(`round ${id} not found`);
      if (!isEditableStatus(existing.status)) {
        throw new InvalidRoundTransitionError(`cannot submit a round in status '${existing.status}' for review`);
      }
      await assertCompleteForSubmission(existing);

      const { roundSubmitted } = await systemSettings.getNotificationSettings();

      const result = await runWorkflowTransition(
        id,
        (existing) => {
          if (!isEditableStatus(existing.status)) {
            throw new InvalidRoundTransitionError(`cannot submit a round in status '${existing.status}' for review`);
          }
        },
        async (client, existing) => {
          // ghs#92/#168: re-checked here too, under the row lock -- the
          // pre-check above ran outside any transaction and could in
          // principle be stale by the time this runs (e.g. a concurrent
          // hole-score deletion) -- this is the authoritative check.
          await assertCompleteForSubmission(existing, client);

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

      // ghs#168 review fix: rescored AFTER the transition commits, not
      // before it opens. Rescoring before the lock (the original shape)
      // left a real race open -- the round is still in an EDITABLE
      // status (draft/rejected/amending) for the entire window between
      // that unlocked rescore and this transition's own lock
      // acquisition, so a concurrent addHoleScore (itself lock-
      // protected, PR #73) could land in between and persist a hole
      // score the rescore never saw, leaving gross/adjusted/
      // differential/pcc silently stale the moment the round becomes
      // 'pending' -- exactly the reliability ghs#168 exists to give the
      // Daily PCC screen. Rescoring here instead is race-free: by now
      // the round is durably 'pending' (isEditableStatus is false), so
      // addHoleScore's own row lock will reject any further write
      // before it can happen -- no further hole-score mutation is
      // possible once this point is reached, so whatever this reads is
      // truly final. ScoringService.recomputeRoundAggregates always uses
      // its own connection (can't be threaded into the transaction
      // above), which is exactly why this has to run after that
      // transaction closes rather than inside it.
      await rescoreRound(id);
      return { round: await repository.get(id), recalculation: result.recalculation };
    },

    async approveRound(id) {
      return approveRoundInternal(id);
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
          // ghs#168: everCountedTowardHandicap(), not
          // "scoreDifferential === null" -- a merely-pending round
          // rejected today already has a real, submission-time-computed
          // differential (it's never been approved, so it never counted)
          // -- the old null-check would have wastefully (though not
          // incorrectly) recalculated on every ordinary rejection. Only
          // 'amending' (rejectRound's only other legal source status)
          // ever actually counted.
          if (!everCountedTowardHandicap(existing.status)) {
            logger.info("round rejected", { roundId: id, playerId: existing.playerId, recalculation: "not applicable -- round was never approved" });
            return null;
          }
          const result = await recalculation.recalculatePlayerHandicap(existing.playerId, "round_rejected", client);
          logger.info("round rejected", { roundId: id, playerId: existing.playerId, recalculationStatus: result.status });
          return result;
        },
      );
    },

    async deleteRound(id, callerRole) {
      return runWorkflowTransition(
        id,
        (existing) => {
          // ghs#147: the authoritative check, under the same lock as
          // every other status-sensitive transition in this file.
          // Fail-closed, not fail-open (review finding, PR #148): only
          // a caller *positively confirmed* as admin/super_admin gets
          // the unrestricted behaviour; anything else -- "player", or
          // any unexpected/malformed value -- is treated as restricted.
          // The previous `callerRole === "player"` check inverted this:
          // an anomalous role value would silently fall through as
          // unrestricted instead of restricted.
          const isAdminCaller = callerRole === "admin" || callerRole === "super_admin";
          if (!isAdminCaller && !isEditableStatus(existing.status)) {
            throw new InvalidRoundTransitionError(`cannot delete a round in status '${existing.status}'`);
          }
        },
        async (client, existing) => {
          await repository.softDelete(id, client);
          // ghs#168: everCountedTowardHandicap(), not
          // "scoreDifferential === null" -- see rejectRound's identical
          // fix above for the full reasoning. deleteRound is reachable
          // from any status (admin-unrestricted), so this also covers
          // 'draft'/'rejected' (never counted, whether or not they
          // happen to have a number in this column) correctly alongside
          // 'pending'.
          if (!everCountedTowardHandicap(existing.status)) {
            logger.info("round deleted", { roundId: id, playerId: existing.playerId, recalculation: "not applicable -- round was never approved" });
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

    async updatePlayedAt(id, playedAt) {
      const result = await runWorkflowTransition(
        id,
        (existing) => {
          if (!isDateEditableStatus(existing.status)) {
            throw new InvalidRoundTransitionError(`cannot change the played date of a round in status '${existing.status}'`);
          }
        },
        async (client) => {
          await repository.updatePlayedAt(id, playedAt, client);
          return null;
        },
      );

      // ghs#168: a pending or rejected round already carries a real,
      // submission-time-computed score/PCC (see needsRescoreAfterDateChange's
      // own comment for why 'draft'/'amending' are excluded) -- rescored
      // as its own separate step after the date change commits (same
      // "can't run inside an existing transaction" reason rescoreRound's
      // every other call site has), reading the round's now-current
      // played_at fresh, so the stored differential never silently keeps
      // reflecting the day it used to be on.
      if (result.round && needsRescoreAfterDateChange(result.round.status)) {
        await rescoreRound(id);
        logger.info("round played date updated, rescored against the new date", { roundId: id, playedAt });
        return { round: await repository.get(id), recalculation: null };
      }

      logger.info("round played date updated", { roundId: id, playedAt, status: result.round?.status });
      return result;
    },
  };
}
