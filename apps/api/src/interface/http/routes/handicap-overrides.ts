import { Router } from "express";
import type { HandicapOverridesService } from "../../../application/handicap-overrides.service.ts";
import type { PlayersRepository } from "../../../data/players.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";
import { ADMIN_ROLES, createPlayerAccessAuthorizer } from "../authorization.ts";

// Request/response shape and input validation live here, not in the
// application layer (ADR-060).
//
// Creating an override is admin-only, matching legacy's real, unambiguous
// behaviour (no open question, per ghs#10). Viewing a player's own
// override history is allowed for that player too (same own-player-or-
// admin pattern as rounds.ts) -- a player should be able to see why their
// own handicap changed, even though only an admin can cause the change.
export function handicapOverridesRouter(
  service: HandicapOverridesService,
  players: PlayersRepository,
  authProvider: AuthProvider,
): Router {
  const router = Router();
  const auth = requireAuth(authProvider);
  const requireAdmin = [auth, requireRole(...ADMIN_ROLES)];
  const authorizeForPlayer = createPlayerAccessAuthorizer(players);

  router.post("/players/:playerId/handicap-overrides", ...requireAdmin, async (req, res, next) => {
    try {
      const playerId = String(req.params.playerId);
      const { newIndex, previousIndex, reason } = req.body as Record<string, unknown>;

      if (typeof newIndex !== "number") {
        res.status(400).json({ error: "newIndex must be a number" });
        return;
      }
      if (previousIndex !== undefined && typeof previousIndex !== "number") {
        res.status(400).json({ error: "previousIndex must be a number if provided" });
        return;
      }
      if (typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ error: "reason is required" });
        return;
      }

      const override = await service.createOverride({
        playerId,
        adminUserId: req.identity!.sub,
        previousIndex: typeof previousIndex === "number" ? previousIndex : undefined,
        newIndex,
        reason: reason.trim(),
      });
      res.status(201).json(override);
    } catch (err) {
      next(err);
    }
  });

  router.get("/players/:playerId/handicap-overrides", auth, async (req, res, next) => {
    try {
      const playerId = String(req.params.playerId);
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot view another player's handicap override history" });
        return;
      }
      res.status(200).json(await service.listOverridesForPlayer(playerId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
