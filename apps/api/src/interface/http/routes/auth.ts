import { Router } from "express";
import type { AuthService } from "../../../application/auth.service.ts";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function authRouter(service: AuthService): Router {
  const router = Router();

  router.post("/auth/register", async (req, res, next) => {
    try {
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

  router.post("/auth/activate", async (req, res, next) => {
    try {
      const { token } = req.body as Record<string, unknown>;
      if (!isNonEmptyString(token)) {
        res.status(400).json({ error: "token is required" });
        return;
      }
      await service.activateAccount(token);
      res.status(200).json({ message: "Account activated." });
    } catch {
      res.status(400).json({ error: "invalid or expired activation token" });
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
    } catch {
      res.status(400).json({ error: "invalid or expired reset token" });
    }
  });

  return router;
}
