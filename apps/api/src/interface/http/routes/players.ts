import { Router } from "express";
import type { Player, PlayersRepository } from "../../../data/players.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import type { HandicapHistoryService } from "../../../application/handicap-history.service.ts";
import type { RoundsService } from "../../../application/rounds.service.ts";
import { requireAuth } from "../middleware/require-auth.ts";
import { createPlayerAccessAuthorizer } from "../authorization.ts";

// ghs#60: a player's own profile + current handicap index -- the first
// player-resource-level endpoint (rounds.ts/handicap-overrides.ts only
// ever exposed player-scoped sub-resources, never the player record
// itself). No PlayersService wrapper -- PlayersRepository.get is already
// the whole operation, matching this route's own dependency directly on
// PlayersRepository for authorizeForPlayer, the same pattern every other
// player-owned-resource route already uses.

// Request/response shape lives here, not the application/data-access
// layers (ADR-060) -- an explicit response DTO, not the raw repository
// Player passed straight through. userId is an internal auth-linkage
// key (players.user_id -> users.id), not profile data the frontend
// needs; returning it verbatim would widen what an admin viewing an
// arbitrary player incidentally learns beyond this endpoint's own
// purpose (review finding, PR #75).
function toPlayerProfileResponse(player: Player) {
  const { userId: _userId, ...profile } = player;
  return profile;
}

export function playersRouter(
  players: PlayersRepository,
  authProvider: AuthProvider,
  handicapHistory: HandicapHistoryService,
  rounds: RoundsService,
): Router {
  const router = Router();
  const auth = requireAuth(authProvider);
  const authorizeForPlayer = createPlayerAccessAuthorizer(players);

  // ghs#89 -- registered before /players/:id (Express route ordering:
  // "me" would otherwise be captured as :id). No ownership check needed,
  // unlike /players/:id -- there's no URL-supplied target to compare
  // against, this route is inherently "my own record." A 404 here is a
  // real, legitimate case (an admin/super_admin account has no player
  // row unless one was explicitly created for it), not an error to hide
  // behind a generic 403 the way an unauthorized cross-player lookup is.
  router.get("/players/me", auth, async (req, res, next) => {
    try {
      const identity = req.identity!;
      const player = await players.findByUserId(identity.sub);
      if (!player) {
        res.status(404).json({ error: "no player profile linked to this account" });
        return;
      }
      res.status(200).json(toPlayerProfileResponse(player));
    } catch (err) {
      next(err);
    }
  });

  router.get("/players/:id", auth, async (req, res, next) => {
    try {
      const playerId = String(req.params.id);
      const identity = req.identity!;
      // Checked before the fetch, not after (unlike rounds.ts's GET
      // /rounds/:id, which must fetch first to learn the round's own
      // playerId) -- authorizeForPlayer only needs the URL's playerId
      // directly, so checking first means an unauthorized caller gets a
      // uniform 403 regardless of whether the player exists, rather than
      // a 404-vs-403 distinction that would otherwise leak which player
      // IDs are real. The message is deliberately generic, not "cannot
      // view another player's profile" -- that would be misleading for
      // the nonexistent-player case this same 403 also covers (review
      // finding, PR #75).
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "forbidden" });
        return;
      }

      const player = await players.get(playerId);
      if (!player) {
        res.status(404).json({ error: "player not found" });
        return;
      }
      res.status(200).json(toPlayerProfileResponse(player));
    } catch (err) {
      next(err);
    }
  });

  // ghs#101: the Dashboard module's handicap-trend chart -- the
  // calculation/storage (handicap-history.service.ts/.repository.ts)
  // already existed; this is just the first HTTP route ever mounted for
  // it. No new calculation, a thin pass-through, same authorization
  // pattern as GET /players/:id above and GET /players/:playerId/rounds
  // (rounds.ts).
  router.get("/players/:playerId/handicap-history", auth, async (req, res, next) => {
    try {
      const playerId = String(req.params.playerId);
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot view another player's handicap history" });
        return;
      }
      res.status(200).json(await handicapHistory.listHistoryForPlayer(playerId));
    } catch (err) {
      next(err);
    }
  });

  // ghs#101: the Dashboard module's Performance Statistics widgets --
  // pure aggregation, no WHS-engine business logic (see rounds.
  // repository.ts's PlayerStats for the full field list and the
  // sand-metric naming decision this issue explicitly requires).
  router.get("/players/:playerId/stats", auth, async (req, res, next) => {
    try {
      const playerId = String(req.params.playerId);
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot view another player's stats" });
        return;
      }
      res.status(200).json(await rounds.getPlayerStats(playerId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
