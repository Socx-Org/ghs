import { Router } from "express";
import type { CoursesService } from "../../../application/courses.service.ts";
import type { CreateCourseInput, CreateHoleInput, CreateTeeConfigurationInput, UpdateCourseInput } from "../../../data/courses.repository.ts";
import { CourseHasRoundsError } from "../../../data/courses.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

// Request/response shape and input validation live here, not in the
// application layer (ADR-060). Mirrors the database's own real domain
// constraints (WHS slope-rating range, hole 1-18, par 3-6) so a bad
// request gets a clean 400 here rather than a raw constraint-violation
// error surfacing from the data layer.
//
// Write routes now admin-gated (ghs#8 closes the gap ghs#7 left open).

function parseHole(value: unknown): CreateHoleInput | null {
  if (typeof value !== "object" || value === null) return null;
  const h = value as Record<string, unknown>;
  if (
    typeof h.holeNumber !== "number" || h.holeNumber < 1 || h.holeNumber > 18 ||
    typeof h.distanceYards !== "number" || h.distanceYards <= 0 ||
    typeof h.par !== "number" || h.par < 3 || h.par > 6 ||
    typeof h.strokeIndex !== "number" || h.strokeIndex < 1 || h.strokeIndex > 18
  ) {
    return null;
  }
  return { holeNumber: h.holeNumber, distanceYards: h.distanceYards, par: h.par, strokeIndex: h.strokeIndex };
}

// Exported for tee-configurations.ts's own standalone update route
// (ghs#99) -- "same validation as create" means the actual same
// function, not a second copy of these rules to keep in sync.
export function parseTeeConfiguration(value: unknown): CreateTeeConfigurationInput | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Record<string, unknown>;
  if (
    typeof t.name !== "string" || t.name.trim().length === 0 ||
    typeof t.holeCount !== "number" || (t.holeCount !== 9 && t.holeCount !== 18) ||
    typeof t.courseRating !== "number" || t.courseRating <= 0 ||
    typeof t.slopeRating !== "number" || t.slopeRating < 55 || t.slopeRating > 155 ||
    !Array.isArray(t.holes)
  ) {
    return null;
  }
  const holes: CreateHoleInput[] = [];
  for (const holeInput of t.holes) {
    const hole = parseHole(holeInput);
    if (!hole) return null;
    holes.push(hole);
  }
  return { name: t.name.trim(), holeCount: t.holeCount, courseRating: t.courseRating, slopeRating: t.slopeRating, holes };
}

export function coursesRouter(service: CoursesService, authProvider: AuthProvider): Router {
  const router = Router();
  const requireAdmin = [requireAuth(authProvider), requireRole("admin", "super_admin")];

  router.get("/courses", async (_req, res, next) => {
    try {
      res.status(200).json(await service.listCourses());
    } catch (err) {
      next(err);
    }
  });

  router.get("/courses/:id", async (req, res, next) => {
    try {
      const course = await service.getCourse(req.params.id!);
      if (!course) {
        res.status(404).json({ error: "course not found" });
        return;
      }
      res.status(200).json(course);
    } catch (err) {
      next(err);
    }
  });

  router.post("/courses", ...requireAdmin, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const { name, clubId, city, country, teeConfigurations } = body;

      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }
      if (clubId !== undefined && typeof clubId !== "string") {
        res.status(400).json({ error: "clubId must be a string" });
        return;
      }

      const input: CreateCourseInput = {
        name: name.trim(),
        clubId: typeof clubId === "string" ? clubId : undefined,
        city: typeof city === "string" ? city : undefined,
        country: typeof country === "string" ? country : undefined,
      };

      if (teeConfigurations !== undefined) {
        if (!Array.isArray(teeConfigurations)) {
          res.status(400).json({ error: "teeConfigurations must be an array" });
          return;
        }
        const parsed: CreateTeeConfigurationInput[] = [];
        for (const teeInput of teeConfigurations) {
          const tee = parseTeeConfiguration(teeInput);
          if (!tee) {
            res.status(400).json({ error: "invalid tee configuration" });
            return;
          }
          parsed.push(tee);
        }
        input.teeConfigurations = parsed;
      }

      const course = await service.createCourse(input);
      res.status(201).json(course);
    } catch (err) {
      next(err);
    }
  });

  // ghs#99. Partial update -- a field is only validated/applied when its
  // key is present in the body at all (matching UpdateCourseInput's own
  // "presence, not truthiness" semantics); null is a valid, meaningful
  // value for the three nullable columns (explicitly clears them), same
  // as createCourse's own optional-string convention but allowing the
  // clear case PATCH additionally needs.
  router.patch("/courses/:id", ...requireAdmin, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const input: UpdateCourseInput = {};

      if ("name" in body) {
        if (typeof body.name !== "string" || body.name.trim().length === 0) {
          res.status(400).json({ error: "name must be a non-empty string" });
          return;
        }
        input.name = body.name.trim();
      }
      if ("clubId" in body) {
        if (body.clubId !== null && typeof body.clubId !== "string") {
          res.status(400).json({ error: "clubId must be a string or null" });
          return;
        }
        input.clubId = body.clubId;
      }
      if ("city" in body) {
        if (body.city !== null && typeof body.city !== "string") {
          res.status(400).json({ error: "city must be a string or null" });
          return;
        }
        input.city = body.city;
      }
      if ("country" in body) {
        if (body.country !== null && typeof body.country !== "string") {
          res.status(400).json({ error: "country must be a string or null" });
          return;
        }
        input.country = body.country;
      }

      const course = await service.updateCourse(String(req.params.id), input);
      if (!course) {
        res.status(404).json({ error: "course not found" });
        return;
      }
      res.status(200).json(course);
    } catch (err) {
      next(err);
    }
  });

  // ghs#99. Soft-delete (deleted_at, matching CoursesRepository.list()'s
  // own existing filter) -- 409 course_has_rounds, not a raw constraint
  // violation, when any of this course's tee configurations is still
  // referenced by an existing round (courses.repository.ts's own
  // CourseHasRoundsError doc comment explains why this is a soft-delete-
  // time business rule, not literally an FK violation).
  router.delete("/courses/:id", ...requireAdmin, async (req, res, next) => {
    try {
      const deleted = await service.deleteCourse(String(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: "course not found" });
        return;
      }
      res.status(200).json({ message: "Course deleted." });
    } catch (err) {
      if (err instanceof CourseHasRoundsError) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // ghs#99. Standalone tee-configuration creation on an existing course
  // -- same parseTeeConfiguration validation createCourse's own nested
  // teeConfigurations[] entries already use, not a second, divergent
  // rule set.
  router.post("/courses/:id/tee-configurations", ...requireAdmin, async (req, res, next) => {
    try {
      const tee = parseTeeConfiguration(req.body);
      if (!tee) {
        res.status(400).json({ error: "invalid tee configuration" });
        return;
      }

      const teeConfiguration = await service.createTeeConfiguration(String(req.params.id), tee);
      if (!teeConfiguration) {
        res.status(404).json({ error: "course not found" });
        return;
      }
      res.status(201).json(teeConfiguration);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
