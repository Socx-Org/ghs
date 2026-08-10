import { Router } from "express";
import type { SystemSettingsService, NotificationSettings } from "../../../application/system-settings.service.ts";
import { InvalidSettingValueError } from "../../../application/system-settings.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

// Changes go through an authenticated, validated admin interface, not
// direct database writes (APP-020). Dedicated, typed endpoints per known
// setting -- GHS's settings are a fixed, finite, GHS-defined vocabulary,
// not a truly arbitrary key/value admin UI, so a generic
// "/admin/settings/:key" passthrough would just push validation back out
// to the caller. Each endpoint below maps directly to one of
// system-settings.service.ts's typed methods.
export function adminSettingsRouter(settings: SystemSettingsService, authProvider: AuthProvider): Router {
  const router = Router();
  const requireAdmin = [requireAuth(authProvider), requireRole("admin", "super_admin")];

  router.get("/admin/settings", ...requireAdmin, async (_req, res, next) => {
    try {
      const [pccOverride, maintenanceMode, selfRegistrationEnabled, notifications] = await Promise.all([
        settings.getPccOverride(),
        settings.getMaintenanceMode(),
        settings.getSelfRegistrationEnabled(),
        settings.getNotificationSettings(),
      ]);
      res.status(200).json({ pccOverride, maintenanceMode, selfRegistrationEnabled, notifications });
    } catch (err) {
      next(err);
    }
  });

  router.put("/admin/settings/pcc-override", ...requireAdmin, async (req, res, next) => {
    try {
      const { value } = req.body as Record<string, unknown>;
      if (value === null) {
        await settings.clearPccOverride(req.identity!.sub);
        res.status(200).json({ pccOverride: null });
        return;
      }
      if (typeof value !== "number") {
        res.status(400).json({ error: "value must be a number or null" });
        return;
      }
      await settings.setPccOverride(value, req.identity!.sub);
      res.status(200).json({ pccOverride: value });
    } catch (err) {
      if (err instanceof InvalidSettingValueError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.put("/admin/settings/maintenance-mode", ...requireAdmin, async (req, res, next) => {
    try {
      const { value } = req.body as Record<string, unknown>;
      if (typeof value !== "boolean") {
        res.status(400).json({ error: "value must be a boolean" });
        return;
      }
      await settings.setMaintenanceMode(value, req.identity!.sub);
      res.status(200).json({ maintenanceMode: value });
    } catch (err) {
      next(err);
    }
  });

  router.put("/admin/settings/self-registration-enabled", ...requireAdmin, async (req, res, next) => {
    try {
      const { value } = req.body as Record<string, unknown>;
      if (typeof value !== "boolean") {
        res.status(400).json({ error: "value must be a boolean" });
        return;
      }
      await settings.setSelfRegistrationEnabled(value, req.identity!.sub);
      res.status(200).json({ selfRegistrationEnabled: value });
    } catch (err) {
      next(err);
    }
  });

  const NOTIFICATION_KEYS: Record<string, keyof NotificationSettings> = {
    "round-submitted": "roundSubmitted",
    "round-approved": "roundApproved",
    "maintenance-alerts": "maintenanceAlerts",
  };

  router.put("/admin/settings/notifications/:type", ...requireAdmin, async (req, res, next) => {
    try {
      const setting = NOTIFICATION_KEYS[String(req.params.type)];
      if (!setting) {
        res.status(404).json({ error: "unknown notification setting" });
        return;
      }
      const { value } = req.body as Record<string, unknown>;
      if (typeof value !== "boolean") {
        res.status(400).json({ error: "value must be a boolean" });
        return;
      }
      await settings.setNotificationSetting(setting, value, req.identity!.sub);
      res.status(200).json({ [setting]: value });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
