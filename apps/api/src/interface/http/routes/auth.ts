import { Router } from "express";
import type { AuthService } from "../../../application/auth.service.ts";
import {
  AccountNotActiveError,
  ActivationTokenAlreadyUsedError,
  ActivationTokenExpiredError,
  ActivationTokenNotFoundError,
  IncorrectPasswordError,
  PasswordResetTokenAlreadyUsedError,
  PasswordResetTokenExpiredError,
  PasswordResetTokenNotFoundError,
} from "../../../application/auth.service.ts";
import type { SystemSettingsService } from "../../../application/system-settings.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth } from "../middleware/require-auth.ts";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function authRouter(service: AuthService, settings: SystemSettingsService, authProvider: AuthProvider): Router {
  const router = Router();
  const auth = requireAuth(authProvider);

  router.post("/auth/register", async (req, res, next) => {
    try {
      // ghs#11: self-registration gate, moved from legacy's env var into
      // system_settings. Unconditional -- unlike legacy's single endpoint
      // (which served both self- and admin-initiated registration and so
      // needed an admin bypass here), GHS already has a separate,
      // properly admin-gated POST /admin/users (ghs#8) for admin-created
      // accounts, which is never subject to this toggle in the first
      // place because it isn't self-registration. Re-adding an admin
      // bypass to this endpoint would be carrying forward legacy's
      // single-endpoint mechanism onto a redesign that doesn't have that
      // constraint -- not a real domain requirement of its own.
      const selfRegistrationEnabled = await settings.getSelfRegistrationEnabled();
      if (!selfRegistrationEnabled) {
        res.status(403).json({ error: "self_registration_disabled" });
        return;
      }

      const { email, password, firstName, lastName, clubId } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(email) || !isNonEmptyString(password) || !isNonEmptyString(firstName) || !isNonEmptyString(lastName)) {
        res.status(400).json({ error: "email, password, firstName, lastName are required" });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: "password must be at least 8 characters" });
        return;
      }
      await service.register({
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        clubId: typeof clubId === "string" ? clubId : undefined,
      });
      res.status(201).json({ message: "Registration successful. Check your email to activate your account." });
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") {
        // Real uniqueness violation -- but respond identically to success
        // to avoid confirming an email is already registered (same
        // enumeration protection as resend-activation).
        res.status(201).json({ message: "Registration successful. Check your email to activate your account." });
        return;
      }
      next(err);
    }
  });

  // ghs#105: unauthenticated -- an anonymous visitor on LoginPage needs
  // to know whether to show a "Create an account" entry point at all,
  // before they have any session. Deliberately narrow (this one flag
  // only, not a general settings-exposure endpoint) -- confirmed no
  // existing public route already carries this (checked /healthz, which
  // is explicitly a bare liveness probe by its own design, and
  // /admin/settings, which is admin-gated).
  router.get("/auth/self-registration-enabled", async (_req, res, next) => {
    try {
      const enabled = await settings.getSelfRegistrationEnabled();
      res.status(200).json({ enabled });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/login", async (req, res, next) => {
    try {
      const { email, password } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
        res.status(400).json({ error: "email and password are required" });
        return;
      }
      const result = await service.login(email.trim().toLowerCase(), password);
      if (result.status === "mfa_required") {
        res.status(200).json({ mfaRequired: true, mfaPendingToken: result.mfaPendingToken });
        return;
      }
      res.status(200).json(result.tokens);
    } catch {
      res.status(401).json({ error: "invalid credentials" });
    }
  });

  router.post("/auth/mfa/verify", async (req, res, next) => {
    try {
      const { mfaPendingToken, code } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(mfaPendingToken) || !isNonEmptyString(code)) {
        res.status(400).json({ error: "mfaPendingToken and code are required" });
        return;
      }
      const tokens = await service.completeMfaLogin(mfaPendingToken, code);
      res.status(200).json(tokens);
    } catch {
      res.status(401).json({ error: "invalid MFA code or pending token" });
    }
  });

  router.post("/auth/refresh", async (req, res, next) => {
    try {
      const { refreshToken } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(refreshToken)) {
        res.status(400).json({ error: "refreshToken is required" });
        return;
      }
      const tokens = await service.refresh(refreshToken);
      res.status(200).json(tokens);
    } catch {
      res.status(401).json({ error: "invalid or expired refresh token" });
    }
  });

  // ghs#59: real logout -- unauthenticated, matching /auth/refresh's own
  // shape (the refresh token itself is the credential presented, not a
  // Bearer access token). Revokes exactly this one token; never other
  // sessions. Idempotent (repository.revokeByHash is a no-op for an
  // unknown or already-revoked hash) -- an unknown/expired/already-used
  // refreshToken still returns 200, matching this auth system's existing
  // enumeration-safe posture elsewhere, and letting the frontend clear
  // local state unconditionally after calling this, without needing to
  // branch on the response.
  router.post("/auth/logout", async (req, res, next) => {
    try {
      const { refreshToken } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(refreshToken)) {
        res.status(400).json({ error: "refreshToken is required" });
        return;
      }
      await service.logout(refreshToken);
      res.status(200).json({ message: "Logged out." });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/activate", async (req, res, next) => {
    try {
      const { token } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(token)) {
        res.status(400).json({ error: "token is required" });
        return;
      }
      await service.activateAccount(token);
      res.status(200).json({ message: "Account activated." });
    } catch (err) {
      // ghs#106: distinguishable codes, not one generic message -- the
      // frontend's activation-landing screen shows genuinely different
      // UI per case (only "expired" offers a resend action).
      if (err instanceof ActivationTokenExpiredError) {
        res.status(400).json({ error: "expired_token" });
        return;
      }
      if (err instanceof ActivationTokenAlreadyUsedError) {
        res.status(400).json({ error: "already_used_token" });
        return;
      }
      if (err instanceof ActivationTokenNotFoundError) {
        res.status(400).json({ error: "invalid_token" });
        return;
      }
      next(err);
    }
  });

  router.post("/auth/resend-activation", async (req, res, next) => {
    try {
      const { email } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(email)) {
        res.status(400).json({ error: "email is required" });
        return;
      }
      await service.resendActivation(email.trim().toLowerCase());
      // Identical response whether or not the email exists or is already
      // active -- deliberate enumeration protection (ghs#8).
      res.status(200).json({ message: "If that account needs activation, a new link has been sent." });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/password-reset/request", async (req, res, next) => {
    try {
      const { email } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(email)) {
        res.status(400).json({ error: "email is required" });
        return;
      }
      await service.requestPasswordReset(email.trim().toLowerCase());
      res.status(200).json({ message: "If that email is registered, a reset link has been sent." });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/password-reset/confirm", async (req, res, next) => {
    try {
      const { token, newPassword } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(token) || !isNonEmptyString(newPassword)) {
        res.status(400).json({ error: "token and newPassword are required" });
        return;
      }
      if (newPassword.length < 8) {
        res.status(400).json({ error: "newPassword must be at least 8 characters" });
        return;
      }
      await service.resetPassword(token, newPassword);
      res.status(200).json({ message: "Password reset." });
    } catch (err) {
      // ghs#107: distinguishable codes, same reasoning and same wire
      // shape as POST /auth/activate (ghs#106) -- the frontend's reset-
      // confirmation screen renders genuinely different UI per case.
      if (err instanceof PasswordResetTokenExpiredError) {
        res.status(400).json({ error: "expired_token" });
        return;
      }
      if (err instanceof PasswordResetTokenAlreadyUsedError) {
        res.status(400).json({ error: "already_used_token" });
        return;
      }
      if (err instanceof PasswordResetTokenNotFoundError) {
        res.status(400).json({ error: "invalid_token" });
        return;
      }
      next(err);
    }
  });

  // ghs#98: the account-level counterpart to GET /players/me -- works
  // for every role, unlike that route (which 404s for admin/super_admin,
  // who have no players row at all).
  router.get("/auth/me", auth, async (req, res, next) => {
    try {
      const profile = await service.getMe(req.identity!.sub);
      if (!profile) {
        res.status(401).json({ error: "account not found" });
        return;
      }
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/change-password", auth, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
        res.status(400).json({ error: "currentPassword and newPassword are required" });
        return;
      }
      if (newPassword.length < 8) {
        res.status(400).json({ error: "newPassword must be at least 8 characters" });
        return;
      }
      await service.changePassword(req.identity!.sub, currentPassword, newPassword);
      res.status(200).json({ message: "Password changed." });
    } catch (err) {
      // Only these two are real, expected outcomes of a change-password
      // attempt -- anything else (e.g. a DB outage, the near-unreachable
      // "account not found" case) falls through to next(err) instead of
      // being misreported as a bad password (review finding, PR #121).
      if (err instanceof IncorrectPasswordError) {
        res.status(400).json({ error: "current password is incorrect" });
        return;
      }
      if (err instanceof AccountNotActiveError) {
        res.status(400).json({ error: "account not active" });
        return;
      }
      next(err);
    }
  });

  return router;
}
