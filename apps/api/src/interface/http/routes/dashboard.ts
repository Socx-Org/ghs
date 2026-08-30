import { Router } from "express";
import type { DashboardService } from "../../../application/dashboard.service.ts";
import type { PlayersRepository } from "../../../data/players.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";
import { ADMIN_ROLES } from "../authorization.ts";

// ghs#180 (design doc section C): the User Trends widget's own period
// selector -- literal UI labels (7d/30d/90d), validated at the HTTP
// boundary and translated to a plain day count before reaching the
// service/repository layers, which deal in numbers, not date-range
// vocabulary (ADR-060).
const TRENDS_PERIODS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DEFAULT_TRENDS_PERIOD = "30d";

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
  const requireAdmin = [auth, requireRole(...ADMIN_ROLES)];

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

  // ghs#180 (design doc sections C/E): the Admin Dashboard's one
  // aggregate call, same per-section failure isolation as GET
  // /dashboard/player. Admin/super_admin-gated -- unlike the heartbeat
  // endpoint it reads presence data from (ghs#177), this is genuinely
  // an admin-only view.
  router.get("/dashboard/admin", ...requireAdmin, async (req, res, next) => {
    try {
      const periodParam = typeof req.query.period === "string" ? req.query.period : DEFAULT_TRENDS_PERIOD;
      const days = TRENDS_PERIODS[periodParam];
      if (!days) {
        res.status(400).json({ error: "period must be one of 7d, 30d, 90d" });
        return;
      }
      res.status(200).json(await dashboard.getAdminDashboard(days));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
