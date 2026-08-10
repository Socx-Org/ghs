import { Router } from "express";
import type { ClubsService } from "../../../application/clubs.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

// Request/response shape and input validation live here, not in the
// application layer (ADR-060).
//
// Write routes now admin-gated (ghs#8 closes the gap ghs#7 deliberately
// left open -- no AuthProvider existed yet at that point). Reads remain
// open to any authenticated context in the future; not gated here since
// no read-visibility requirement has been identified.
export function clubsRouter(service: ClubsService, authProvider: AuthProvider): Router {
  const router = Router();
  const requireAdmin = [requireAuth(authProvider), requireRole("admin", "super_admin")];

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

  router.post("/clubs", ...requireAdmin, async (req, res, next) => {
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
