import { Router } from "express";
import type { ClubsService } from "../../../application/clubs.service.ts";

// Request/response shape and input validation live here, not in the
// application layer (ADR-060).
//
// No auth applied yet -- deliberate, not an oversight: ghs#8 (Player &
// User Identity) hasn't landed, so no AuthProvider exists to gate this
// with. Matches reference/application's own demonstrated widgets routes,
// which are also unauthenticated for the same structural reason (no ADR
// had settled an approach when it was written). Wiring real admin-only
// auth onto these write routes is follow-up work once ghs#8 lands, not
// silently deferred without a trace.
export function clubsRouter(service: ClubsService): Router {
  const router = Router();

  router.get("/clubs", async (_req, res, next) => {
    try {
      res.status(200).json(await service.listClubs());
    } catch (err) {
      next(err);
    }
  });

  router.get("/clubs/:id", async (req, res, next) => {
    try {
      const club = await service.getClub(req.params.id!);
      if (!club) {
        res.status(404).json({ error: "club not found" });
        return;
      }
      res.status(200).json(club);
    } catch (err) {
      next(err);
    }
  });

  router.post("/clubs", async (req, res, next) => {
    try {
      const { name, city, country } = req.body as { name?: unknown; city?: unknown; country?: unknown };
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }
      if (country !== undefined && (typeof country !== "string" || country.length !== 2)) {
        res.status(400).json({ error: "country must be a 2-letter ISO code" });
        return;
      }
      const club = await service.createClub({
        name: name.trim(),
        city: typeof city === "string" ? city : undefined,
        country: typeof country === "string" ? country : undefined,
      });
      res.status(201).json(club);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
