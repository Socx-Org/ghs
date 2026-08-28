import { Router } from "express";
import type { DashboardService } from "../../../application/dashboard.service.ts";
import type { PlayersRepository } from "../../../data/players.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth } from "../middleware/require-auth.ts";

// ghs#176 (design doc section E): one aggregate call the Player
// Dashboard fetches on load, instead of the page making 3+ independent
// requests. Always the caller's own dashboard, not a `:playerId` route
// param like GET /players/:playerId/stats -- there's no real "view
// another player's dashboard" case for this endpoint (unlike /stats,
// which an admin screen elsewhere may look up for a specific player).
// Same own-data resolution as GET /players/me (players.ts): identity ->
// linked player via findByUserId, 404 when none exists -- a real,
// legitimate case (an admin/super_admin account with no player row),
// not an error to hide behind 403.
export function dashboardRouter(dashboard: DashboardService, players: PlayersRepository, authProvider: AuthProvider): Router {
  const router = Router();
  const auth = requireAuth(authProvider);

  router.get("/dashboard/player", auth, async (req, res, next) => {
    try {
      const identity = req.identity!;
      const player = await players.findByUserId(identity.sub);
      if (!player) {
        res.status(404).json({ error: "no player profile linked to this account" });
        return;
      }
      res.status(200).json(await dashboard.getPlayerDashboard(player.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
