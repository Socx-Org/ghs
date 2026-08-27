import { Router } from "express";
import type { PccService } from "../../../application/pcc.service.ts";
import { InvalidPccInputError } from "../../../application/pcc.service.ts";
import type { RecalculationOrchestrator } from "../../../application/recalculation.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";
import { ADMIN_ROLES } from "../authorization.ts";

// Admin-only: PCC is a per-tee-configuration-per-day calculation with a
// real effect on every round played there that day (rewrites
// score_differential in bulk) -- not a player-facing endpoint.
//
// ghs#168 review fix: the PATCH route below previously called
// pcc.calculateOrOverride() directly, bypassing recalculation.
// recalculatePccForTeeConfigDay() entirely -- meaning a PCC correction
// bulk-rewrote every affected round's score_differential but NEVER
// actually recalculated any affected player's handicap index, despite
// this issue's own acceptance criteria requiring exactly that. The
// orchestrator method (recalculation.service.ts) already existed,
// already correct and tested, just never wired to this route -- a real
// gap in already-built-but-never-actually-called machinery, not new WHS
// math. Still takes `pcc` directly for the read-only GET below, which
// has no recalculation concern of its own.
export function adminPccRouter(pcc: PccService, recalculation: RecalculationOrchestrator, authProvider: AuthProvider): Router {
  const router = Router();
  const requireAdmin = [requireAuth(authProvider), requireRole(...ADMIN_ROLES)];

  router.get("/admin/tee-configurations/:teeConfigurationId/pcc", ...requireAdmin, async (req, res, next) => {
    try {
      const playedOn = req.query.playedOn;
      if (typeof playedOn !== "string" || !playedOn) {
        res.status(400).json({ error: "playedOn query parameter is required" });
        return;
      }
      const dailyPcc = await pcc.getOrCreateDailyPcc(String(req.params.teeConfigurationId), playedOn);
      res.status(200).json({ dailyPcc });
    } catch (err) {
      if (err instanceof InvalidPccInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.patch("/admin/tee-configurations/:teeConfigurationId/pcc", ...requireAdmin, async (req, res, next) => {
    try {
      const { playedOn, pcc: pccValue } = req.body as Record<string, unknown>;
      if (typeof playedOn !== "string" || !playedOn) {
        res.status(400).json({ error: "playedOn is required" });
        return;
      }
      if (pccValue !== null && pccValue !== undefined && typeof pccValue !== "number") {
        res.status(400).json({ error: "pcc must be a number, null, or omitted" });
        return;
      }

      const result = await recalculation.recalculatePccForTeeConfigDay(
        String(req.params.teeConfigurationId),
        playedOn,
        typeof pccValue === "number" ? pccValue : null,
        req.identity!.sub,
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof InvalidPccInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}
