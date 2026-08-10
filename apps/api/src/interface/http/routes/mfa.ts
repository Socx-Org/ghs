import { Router } from "express";
import type { MfaService } from "../../../application/mfa.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth } from "../middleware/require-auth.ts";

// Self-service, authenticated -- a user enrolls their own MFA. No admin
// gating needed here; disabling another user's MFA (recovery) is an
// admin-users concern, not this router's.
export function mfaRouter(service: MfaService, authProvider: AuthProvider): Router {
  const router = Router();
  const auth = requireAuth(authProvider);

  router.post("/auth/mfa/enroll", auth, async (req, res, next) => {
    try {
      const identity = req.identity!;
      const result = await service.enrollTotp(identity.sub, identity.email);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/mfa/enroll/confirm", auth, async (req, res, next) => {
    try {
      const { code } = req.body as Record<string, unknown>;
      if (typeof code !== "string" || code.trim().length === 0) {
        res.status(400).json({ error: "code is required" });
        return;
      }
      const result = await service.confirmTotpEnrollment(req.identity!.sub, code);
      res.status(200).json(result);
    } catch {
      res.status(400).json({ error: "invalid code" });
    }
  });

  return router;
}
