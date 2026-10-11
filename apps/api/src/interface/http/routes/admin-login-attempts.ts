import { Router } from "express";
import type { LoginAttemptsService } from "../../../application/login-attempts.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

// ghs#231: same pagination shape as GET /admin/users (ghs#98) -- a page
// size default/cap, not the "fetch-all, filter client-side" convention
// GET /admin/rounds uses, since this table (every login attempt, ever)
// has no natural bound the way rounds/accounts roughly do.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function adminLoginAttemptsRouter(service: LoginAttemptsService, authProvider: AuthProvider): Router {
  const router = Router();
  const requireAdmin = [requireAuth(authProvider), requireRole("admin", "super_admin")];

  router.get("/admin/login-attempts", ...requireAdmin, async (req, res, next) => {
    try {
      const { limit, offset } = req.query;

      const parsedLimit = typeof limit === "string" ? Number.parseInt(limit, 10) : NaN;
      const resolvedLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

      const parsedOffset = typeof offset === "string" ? Number.parseInt(offset, 10) : NaN;
      const resolvedOffset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

      const result = await service.list(resolvedLimit, resolvedOffset);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
