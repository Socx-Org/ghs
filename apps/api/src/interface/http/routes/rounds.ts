import { Router } from "express";
import type { RoundsService } from "../../../application/rounds.service.ts";
import { IncompleteRoundError, InvalidRoundTransitionError, RoundNotFoundError } from "../../../application/rounds.service.ts";
import type { PlayersRepository } from "../../../data/players.repository.ts";
import type { CreateHoleScoreInput, FairwayResult } from "../../../data/rounds.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";
import { ADMIN_ROLES, createPlayerAccessAuthorizer } from "../authorization.ts";
import { HoleMetadataNotFoundError } from "../../../application/scoring.service.ts";

const FAIRWAY_RESULTS: FairwayResult[] = ["hit", "missed_left", "missed_right"];

// ghs#100/#113. Same validation/pagination convention as GET
// /admin/users (admin-users.ts) -- one established pattern for
// query-param-filtered admin lists, not a second one invented here.
const VALID_ROUND_STATUSES = ["draft", "pending", "approved", "rejected", "amending"] as const;
const DEFAULT_ADMIN_ROUNDS_LIMIT = 50;
const MAX_ADMIN_ROUNDS_LIMIT = 200;

// Request/response shape and input validation live here, not in the
// application layer (ADR-060).
//
// Authorization: unlike clubs/courses (admin-only reference data), round
// submission is a real, primary player-facing action -- a `player`-role
// caller may only act on their own linked player record;
// `admin`/`super_admin` may act on any player's rounds (e.g. entering a
// paper scorecard on a member's behalf). Same pattern as
// handicap-overrides.ts's read access. This is real authorization on an
// existing repository operation, not new business/workflow logic --
// approval behaviour (recalculation, notification) remains Phase 2's
// scope.
export function roundsRouter(service: RoundsService, players: PlayersRepository, authProvider: AuthProvider): Router {
  const router = Router();
  const auth = requireAuth(authProvider);
  const requireAdmin = [auth, requireRole(...ADMIN_ROLES)];
  const authorizeForPlayer = createPlayerAccessAuthorizer(players);

  function parseFairwayResult(value: unknown): FairwayResult | undefined | null {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string" && FAIRWAY_RESULTS.includes(value as FairwayResult)) return value as FairwayResult;
    throw new Error("invalid fairway result");
  }

  router.post("/rounds", auth, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const { playerId, teeConfigurationId, playedAt, playingHandicap, isTournament, is9Hole } = body;

      if (typeof playerId !== "string" || typeof teeConfigurationId !== "string" || typeof playedAt !== "string") {
        res.status(400).json({ error: "playerId, teeConfigurationId, playedAt are required" });
        return;
      }

      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot submit a round for another player" });
        return;
      }

      const round = await service.createRound({
        playerId,
        teeConfigurationId,
        playedAt,
        playingHandicap: typeof playingHandicap === "number" ? playingHandicap : undefined,
        isTournament: isTournament === true,
        is9Hole: is9Hole === true,
        // ghs#100: captured at creation time for submitForReview's own
        // later auto-approval decision (migration 014's own doc
        // comment explains why). Cast, not re-validated -- ghsRole is a
        // verified JWT claim by the time requireAuth populates
        // req.identity, itself only ever set from users.role's own
        // CHECK-constrained column, so it's already a trusted value
        // here, not raw external input needing its own guard.
        createdByRole: identity.ghsRole as "player" | "admin" | "super_admin",
      });
      res.status(201).json(round);
    } catch (err) {
      next(err);
    }
  });

  router.get("/rounds/:id", auth, async (req, res, next) => {
    try {
      const round = await service.getRound(String(req.params.id));
      if (!round) {
        res.status(404).json({ error: "round not found" });
        return;
      }
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, round.playerId))) {
        res.status(403).json({ error: "cannot view another player's round" });
        return;
      }
      res.status(200).json(round);
    } catch (err) {
      next(err);
    }
  });

  router.get("/players/:playerId/rounds", auth, async (req, res, next) => {
    try {
      const playerId = String(req.params.playerId);
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot list another player's rounds" });
        return;
      }
      res.status(200).json(await service.listRoundsForPlayer(playerId));
    } catch (err) {
      next(err);
    }
  });

  router.post("/rounds/:id/holes", auth, async (req, res, next) => {
    try {
      const roundId = String(req.params.id);
      const round = await service.getRound(roundId);
      if (!round) {
        res.status(404).json({ error: "round not found" });
        return;
      }
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, round.playerId))) {
        res.status(403).json({ error: "cannot add a hole score to another player's round" });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const { holeNumber, strokes, putts, gir, inSand, penalties, netDoubleBogeyAdjusted } = body;
      if (typeof holeNumber !== "number" || holeNumber < 1 || holeNumber > 18) {
        res.status(400).json({ error: "holeNumber must be between 1 and 18" });
        return;
      }
      if (typeof strokes !== "number" || strokes < 1) {
        res.status(400).json({ error: "strokes must be a positive number" });
        return;
      }

      let fairwayResult: FairwayResult | undefined | null;
      try {
        fairwayResult = parseFairwayResult(body.fairwayResult);
      } catch {
        res.status(400).json({ error: "fairwayResult must be one of hit, missed_left, missed_right, or omitted" });
        return;
      }

      // gir/inSand: omitted must stay undefined, not collapse to false --
      // this is now an upsert (ghs#92), and an omitted field means
      // "preserve whatever was already recorded" (rounds.repository.ts's
      // COALESCE-on-omission), not "the caller is asserting false."
      // Re-POSTing only {holeNumber, strokes} to correct a stroke count
      // must not silently wipe a previously-recorded gir: true (review
      // finding, PR #93).
      const input: CreateHoleScoreInput = {
        holeNumber,
        strokes,
        putts: typeof putts === "number" ? putts : undefined,
        gir: typeof gir === "boolean" ? gir : undefined,
        fairwayResult: fairwayResult ?? undefined,
        inSand: typeof inSand === "boolean" ? inSand : undefined,
        penalties: typeof penalties === "number" ? penalties : undefined,
        netDoubleBogeyAdjusted: typeof netDoubleBogeyAdjusted === "number" ? netDoubleBogeyAdjusted : undefined,
      };
      // `round` was already fetched above for the authorization check --
      // passed through so the service doesn't re-fetch it a second time
      // (caught in review, PR #27). The 1-18 check above is a cheap
      // structural bound; whether this specific tee configuration
      // actually has this hole is a real business rule the service
      // itself enforces (it has the tee configuration's actual hole
      // data, which this route deliberately doesn't also fetch just to
      // duplicate that check) -- surfaced here as a 400, not left to
      // fall through to the generic 500 handler.
      const holeScore = await service.addHoleScore(roundId, input, round);
      // 200 uniformly, not 201-on-insert/200-on-update -- ghs#92 made
      // this a real upsert (re-recording an already-scored hole is
      // idempotent, not an error), so this is "record this hole's
      // score," not a strict REST create.
      res.status(200).json(holeScore);
    } catch (err) {
      if (err instanceof HoleMetadataNotFoundError) {
        res.status(400).json({ error: err.message });
        return;
      }
      // ghs#58: addHoleScore now rejects an attempt to edit a round that
      // isn't draft/rejected/amending (e.g. pending, under active
      // review) -- same 409 treatment as every other invalid workflow
      // transition below, not left to fall through to the generic 500
      // handler.
      if (err instanceof InvalidRoundTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      // addHoleScore's own row-locked existence check (review fix, PR
      // #73) can in principle still throw this in the narrow window
      // between the round-existence check above and its own lock --
      // same 404 treatment as every other round route below, for
      // consistency, not left to fall through to the generic 500
      // handler.
      if (err instanceof RoundNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // ghs#58: the explicit, player-initiated moment a round becomes
  // visible to the admin pending-queue -- ownership-checked exactly like
  // every other player-facing round route above, not admin-gated (a
  // player submits their own round; approval/rejection remains
  // admin-only, unchanged, below).
  router.post("/rounds/:id/submit", auth, async (req, res, next) => {
    try {
      const roundId = String(req.params.id);
      const round = await service.getRound(roundId);
      if (!round) {
        res.status(404).json({ error: "round not found" });
        return;
      }
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, round.playerId))) {
        res.status(403).json({ error: "cannot submit another player's round" });
        return;
      }

      // ghs#100 review fix, PR #141: the actual caller's role right now,
      // not just who created the round -- see submitForReview's own doc
      // comment for why both are needed.
      res.status(200).json(await service.submitForReview(roundId, identity.ghsRole as "player" | "admin" | "super_admin"));
    } catch (err) {
      if (err instanceof RoundNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidRoundTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      // ghs#92: incomplete hole scores -- same 409 treatment as every
      // other invalid workflow attempt above, not left to fall through
      // to the generic 500 handler.
      if (err instanceof IncompleteRoundError) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // ghs#61: the admin pending-review queue -- purpose-built and
  // deliberately narrow (no pagination/filtering/sorting query params),
  // matching the approved scope. Not a generic admin rounds browser;
  // raise that separately if a real requirement for one is ever
  // approved. Mounted before the /rounds/:id-shaped routes below, but
  // ordering doesn't actually matter here -- /admin/rounds/pending
  // shares no path segment with /rounds/:id at all.
  router.get("/admin/rounds/pending", ...requireAdmin, async (_req, res, next) => {
    try {
      res.status(200).json(await service.listPendingQueue());
    } catch (err) {
      next(err);
    }
  });

  // ghs#100/#113: the general admin all-rounds browser -- filterable by
  // status/player, paginated. A separate endpoint from the pending
  // queue above, not a generalisation of it -- that one stays
  // purpose-built and deliberately narrow.
  router.get("/admin/rounds", ...requireAdmin, async (req, res, next) => {
    try {
      const { status, playerId, limit, offset } = req.query;

      let resolvedStatus: (typeof VALID_ROUND_STATUSES)[number] | undefined;
      if (status !== undefined) {
        if (typeof status !== "string" || !VALID_ROUND_STATUSES.includes(status as (typeof VALID_ROUND_STATUSES)[number])) {
          res.status(400).json({ error: "status must be one of: draft, pending, approved, rejected, amending" });
          return;
        }
        resolvedStatus = status as (typeof VALID_ROUND_STATUSES)[number];
      }

      let resolvedPlayerId: string | undefined;
      if (playerId !== undefined) {
        if (typeof playerId !== "string") {
          res.status(400).json({ error: "playerId must be a string" });
          return;
        }
        resolvedPlayerId = playerId;
      }

      const parsedLimit = typeof limit === "string" ? Number.parseInt(limit, 10) : NaN;
      const resolvedLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_ADMIN_ROUNDS_LIMIT) : DEFAULT_ADMIN_ROUNDS_LIMIT;

      const parsedOffset = typeof offset === "string" ? Number.parseInt(offset, 10) : NaN;
      const resolvedOffset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

      const result = await service.listAdminRounds({ status: resolvedStatus, playerId: resolvedPlayerId, limit: resolvedLimit, offset: resolvedOffset });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Every transition below is admin-only (matching legacy's real,
  // unambiguous behaviour, and ghs#9's existing precedent for status
  // changes) and real workflow behaviour, not a bare field update: each
  // one triggers the appropriate recalculation via RoundsService, in the
  // same transaction as the state change (ghs#23/24).
  //
  // A single PATCH .../status endpoint dispatches by target status
  // rather than three separate URLs -- preserves the existing route
  // shape ghs#9 already shipped and tested (only the behaviour
  // underneath was the gap), while 'amending' fits the same "target
  // status" shape as a fourth legal value. Legacy's own 'pending' target
  // (a bare, no-op-equivalent reversion with no real semantics anywhere
  // in this design) is not preserved -- no legitimate use case for it
  // was identified during planning.
  router.patch("/rounds/:id/status", ...requireAdmin, async (req, res, next) => {
    try {
      const roundId = String(req.params.id);
      const { status, rejectionReason, reason } = req.body as Record<string, unknown>;
      // Trimmed before the fallback, not after: a blank rejectionReason
      // ("") must not shadow a real value in reason (caught in review, PR
      // #32 -- the untrimmed version picked whichever field was merely a
      // string, so rejectionReason: "" alongside a valid reason: "..."
      // was wrongly rejected as missing). The trimmed value is also what
      // gets persisted, so stray leading/trailing whitespace never reaches
      // rounds.rejection_reason.
      const rejectionReasonTrimmed = typeof rejectionReason === "string" ? rejectionReason.trim() : "";
      const reasonTrimmed = typeof reason === "string" ? reason.trim() : "";
      const effectiveReason = rejectionReasonTrimmed || reasonTrimmed || undefined;

      if (status === "approved") {
        res.status(200).json(await service.approveRound(roundId));
        return;
      }
      if (status === "rejected") {
        if (!effectiveReason) {
          res.status(400).json({ error: "rejectionReason is required" });
          return;
        }
        res.status(200).json(await service.rejectRound(roundId, effectiveReason));
        return;
      }
      if (status === "amending") {
        if (!effectiveReason) {
          res.status(400).json({ error: "reason is required to reopen a round for amendment" });
          return;
        }
        res.status(200).json(await service.reopenForAmendment(roundId, effectiveReason));
        return;
      }
      res.status(400).json({ error: "status must be 'approved', 'rejected', or 'amending'" });
    } catch (err) {
      if (err instanceof RoundNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidRoundTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // ghs#147: no longer admin-only -- a player may now delete their own
  // round too (the service layer enforces the editable-status
  // restriction that applies only to a player caller; admin/super_admin
  // keep the pre-existing unrestricted-status behaviour). Ownership
  // checked here, same pattern as every other player-facing round route
  // above, not a new authorization concept.
  router.delete("/rounds/:id", auth, async (req, res, next) => {
    try {
      const roundId = String(req.params.id);
      const round = await service.getRound(roundId);
      if (!round) {
        res.status(404).json({ error: "round not found" });
        return;
      }
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, round.playerId))) {
        res.status(403).json({ error: "cannot delete another player's round" });
        return;
      }
      res.status(200).json(await service.deleteRound(roundId, identity.ghsRole as "player" | "admin" | "super_admin"));
    } catch (err) {
      if (err instanceof RoundNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidRoundTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}
