import { Router } from "express";
import type { AdminUsersService } from "../../../application/admin-users.service.ts";
import type { MfaService } from "../../../application/mfa.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

const VALID_ROLES = ["player", "admin", "super_admin"] as const;

export function adminUsersRouter(service: AdminUsersService, mfaService: MfaService, authProvider: AuthProvider): Router {
  const router = Router();
  const requireAdmin = [requireAuth(authProvider), requireRole("admin", "super_admin")];

  router.post("/admin/users", ...requireAdmin, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const { email, password, role, firstName, lastName, clubId, autoActivate } = body;

      if (typeof email !== "string" || email.trim().length === 0) {
        res.status(400).json({ error: "email must be a non-empty string" });
        return;
      }
      if (typeof password !== "string" || password.length < 8) {
        res.status(400).json({ error: "password must be at least 8 characters" });
        return;
      }
      const resolvedRole = typeof role === "string" ? role : "player";
      if (!VALID_ROLES.includes(resolvedRole as (typeof VALID_ROLES)[number])) {
        res.status(400).json({ error: "role must be one of: player, admin, super_admin" });
        return;
      }
      // ghs#50: only super_admin may create or promote to admin/
      // super_admin -- a plain admin may still create player accounts
      // (unchanged). Explicit 403, never a silent downgrade to player --
      // the caller's literal request is honestly rejected, not
      // reinterpreted as something else. Same placement/pattern as
      // authorization.ts's authorizeForPlayer: an authorization decision
      // enforced at the route layer, not a domain error thrown by the
      // service (the service has no concept of "who is calling" at all,
      // by design, matching every other route's own ownership checks).
      if (resolvedRole !== "player" && req.identity!.ghsRole !== "super_admin") {
        res.status(403).json({ error: "only super_admin may create admin or super_admin accounts" });
        return;
      }
      if (typeof firstName !== "string" || typeof lastName !== "string" || firstName.trim().length === 0 || lastName.trim().length === 0) {
        res.status(400).json({ error: "firstName and lastName are required" });
        return;
      }

      const result = await service.adminCreateUser({
        email: email.trim().toLowerCase(),
        password,
        role: resolvedRole as "player" | "admin" | "super_admin",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        clubId: typeof clubId === "string" ? clubId : undefined,
        autoActivate: autoActivate === true,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/users/:id/status", ...requireAdmin, async (req, res, next) => {
    try {
      const { status } = req.body as Record<string, unknown>;
      if (status !== "active" && status !== "disabled") {
        res.status(400).json({ error: "status must be 'active' or 'disabled'" });
        return;
      }
      await service.setUserStatus(String(req.params.id), status);
      res.status(200).json({ message: `User status set to ${status}.` });
    } catch (err) {
      next(err);
    }
  });

  // Admin-initiated MFA recovery (IAM-020) -- same authority tier as
  // account enable/disable.
  router.delete("/admin/users/:id/mfa", ...requireAdmin, async (req, res, next) => {
    try {
      await mfaService.disableMfa(String(req.params.id));
      res.status(200).json({ message: "MFA disabled for user." });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
