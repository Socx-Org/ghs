import { Router } from "express";
import type { CoursesService } from "../../../application/courses.service.ts";
import type { CreateCourseInput, CreateHoleInput, CreateTeeConfigurationInput } from "../../../data/courses.repository.ts";

// Request/response shape and input validation live here, not in the
// application layer (ADR-060). Mirrors the database's own real domain
// constraints (WHS slope-rating range, hole 1-18, par 3-6) so a bad
// request gets a clean 400 here rather than a raw constraint-violation
// error surfacing from the data layer.
//
// No auth applied yet -- same deliberate, tracked gap as clubs.ts; ghs#8
// hasn't landed.

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

function parseTeeConfiguration(value: unknown): CreateTeeConfigurationInput | null {
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

export function coursesRouter(service: CoursesService): Router {
  const router = Router();

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

  router.post("/courses", async (req, res, next) => {
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

  return router;
}
