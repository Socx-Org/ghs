import { Router } from "express";
import type { CoursesService } from "../../../application/courses.service.ts";

// ghs#92: a round only ever stores teeConfigurationId, not the owning
// course id -- resuming an in-progress round (rendering the hole-entry
// screen from an existing round) had no path to hole/par metadata
// without also knowing which course to look it up under. Unauthenticated,
// same convention as GET /courses and GET /courses/:id (courses.ts) --
// public read data, no player-specific information.
export function teeConfigurationsRouter(courses: CoursesService): Router {
  const router = Router();

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

  return router;
}
