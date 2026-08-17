import { Router } from "express";
import type { PlayersRepository } from "../../../data/players.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth } from "../middleware/require-auth.ts";
import { createPlayerAccessAuthorizer } from "../authorization.ts";

// ghs#60: a player's own profile + current handicap index -- the first
// player-resource-level endpoint (rounds.ts/handicap-overrides.ts only
// ever exposed player-scoped sub-resources, never the player record
// itself). No PlayersService wrapper -- PlayersRepository.get is already
// the whole operation, matching this route's own dependency directly on
// PlayersRepository for authorizeForPlayer, the same pattern every other
// player-owned-resource route already uses.
export function playersRouter(players: PlayersRepository, authProvider: AuthProvider): Router {
  const router = Router();
  const auth = requireAuth(authProvider);
  const authorizeForPlayer = createPlayerAccessAuthorizer(players);

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
      // IDs are real.
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot view another player's profile" });
        return;
      }

      const player = await players.get(playerId);
      if (!player) {
        res.status(404).json({ error: "player not found" });
        return;
      }
      res.status(200).json(player);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
