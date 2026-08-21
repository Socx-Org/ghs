import { Router } from "express";
import type { CoursesService } from "../../../application/courses.service.ts";
import { TeeConfigurationHasRoundsError } from "../../../data/courses.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";
import { parseTeeConfiguration } from "./courses.ts";

// ghs#92: a round only ever stores teeConfigurationId, not the owning
// course id -- resuming an in-progress round (rendering the hole-entry
// screen from an existing round) had no path to hole/par metadata
// without also knowing which course to look it up under. Unauthenticated,
// same convention as GET /courses and GET /courses/:id (courses.ts) --
// public read data, no player-specific information.
export function teeConfigurationsRouter(courses: CoursesService, authProvider: AuthProvider): Router {
  const router = Router();
  const requireAdmin = [requireAuth(authProvider), requireRole("admin", "super_admin")];

  router.get("/tee-configurations/:id", async (req, res, next) => {
    try {
      const teeConfiguration = await courses.getTeeConfiguration(req.params.id!);
      if (!teeConfiguration) {
        res.status(404).json({ error: "tee configuration not found" });
        return;
      }
      res.status(200).json(teeConfiguration);
    } catch (err) {
      next(err);
    }
  });

  // ghs#99. Full replacement, same parseTeeConfiguration validation as
  // POST /courses (courses.ts) and POST /courses/:id/tee-configurations
  // -- one shared rule set, not a second copy.
  router.patch("/tee-configurations/:id", ...requireAdmin, async (req, res, next) => {
    try {
      const tee = parseTeeConfiguration(req.body);
      if (!tee) {
        res.status(400).json({ error: "invalid tee configuration" });
        return;
      }

      const teeConfiguration = await courses.updateTeeConfiguration(String(req.params.id), tee);
      if (!teeConfiguration) {
        res.status(404).json({ error: "tee configuration not found" });
        return;
      }
      res.status(200).json(teeConfiguration);
    } catch (err) {
      next(err);
    }
  });

  // ghs#99. Soft-delete -- same referenced-by-rounds 409 conflict
  // handling as DELETE /courses/:id (courses.ts), see
  // TeeConfigurationHasRoundsError's own doc comment
  // (courses.repository.ts).
  router.delete("/tee-configurations/:id", ...requireAdmin, async (req, res, next) => {
    try {
      const deleted = await courses.deleteTeeConfiguration(String(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: "tee configuration not found" });
        return;
      }
      res.status(200).json({ message: "Tee configuration deleted." });
    } catch (err) {
      if (err instanceof TeeConfigurationHasRoundsError) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}
