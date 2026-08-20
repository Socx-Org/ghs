import { Router } from "express";
import type { AdminUsersService } from "../../../application/admin-users.service.ts";
import type { MfaService } from "../../../application/mfa.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

const VALID_ROLES = ["player", "admin", "super_admin"] as const;
const VALID_STATUSES = ["pending_verification", "active", "disabled", "deleted"] as const;

// ghs#98: no default page size cap this large -- 50 is a real starting
// point for a small club's account list, 200 is generous headroom
// without letting a single request pull the entire table.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

  // ghs#98: registered before /admin/users/:id-shaped routes below --
  // no path-param collision risk here (this is the bare collection
  // route, not a "/me"-vs-":id" ordering concern like players.ts has).
  //
  // Query parameters (all optional):
  //   role    -- one of VALID_ROLES above; 400 if present and invalid.
  //   status  -- one of VALID_STATUSES above; 400 if present and invalid.
  //              No default exclusion of 'deleted' -- unlike players'/
  //              courses' deleted_at soft-delete convention, status is
  //              a first-class value here, and an admin listing accounts
  //              needs full visibility by default (see users.repository.ts).
  //   limit   -- page size, default 50, capped at 200. Non-positive or
  //              non-integer values fall back to the default rather
  //              than erroring.
  //   offset  -- row offset, default 0. Negative or non-integer values
  //              fall back to 0.
  router.get("/admin/users", ...requireAdmin, async (req, res, next) => {
    try {
      const { role, status, limit, offset } = req.query;

      let resolvedRole: (typeof VALID_ROLES)[number] | undefined;
      if (typeof role === "string" && role.length > 0) {
        if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
          res.status(400).json({ error: "role must be one of: player, admin, super_admin" });
          return;
        }
        resolvedRole = role as (typeof VALID_ROLES)[number];
      }

      let resolvedStatus: (typeof VALID_STATUSES)[number] | undefined;
      if (typeof status === "string" && status.length > 0) {
        if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
          res.status(400).json({ error: "status must be one of: pending_verification, active, disabled, deleted" });
          return;
        }
        resolvedStatus = status as (typeof VALID_STATUSES)[number];
      }

      const parsedLimit = typeof limit === "string" ? Number.parseInt(limit, 10) : NaN;
      const resolvedLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

      const parsedOffset = typeof offset === "string" ? Number.parseInt(offset, 10) : NaN;
      const resolvedOffset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

      const result = await service.listUsers({ role: resolvedRole, status: resolvedStatus, limit: resolvedLimit, offset: resolvedOffset });
      res.status(200).json(result);
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

  // ghs#98: self-deletion explicitly rejected here at the route layer --
  // same placement reasoning as the role-elevation check above (the
  // service has no concept of "who is calling", by design). An admin
  // locking themselves out of their own account is never a legitimate
  // outcome of this endpoint.
  router.delete("/admin/users/:id", ...requireAdmin, async (req, res, next) => {
    try {
      const targetId = String(req.params.id);
      if (targetId === req.identity!.sub) {
        res.status(400).json({ error: "cannot delete your own account" });
        return;
      }
      await service.deleteUser(targetId);
      res.status(200).json({ message: "User deleted." });
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
