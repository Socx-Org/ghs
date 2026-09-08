import { Router } from "express";
import type { ActiveUsersChartPeriod, SystemSettingsService, NotificationSettings } from "../../../application/system-settings.service.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

const ACTIVE_USERS_CHART_PERIODS: readonly ActiveUsersChartPeriod[] = ["24h", "week", "month"];
// ghs#209: mirrors system-settings.service.ts's own internal bounds --
// duplicated here rather than imported, same as ACTIVE_USERS_CHART_PERIODS
// above re-deriving its own runtime vocabulary for route-level validation.
const PLAYER_STATS_ROUNDS_WINDOW_MIN = 1;
const PLAYER_STATS_ROUNDS_WINDOW_MAX = 200;

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
      const [maintenanceMode, selfRegistrationEnabled, notifications, activeUsersChartPeriod, playerStatsRoundsWindow] = await Promise.all([
        settings.getMaintenanceMode(),
        settings.getSelfRegistrationEnabled(),
        settings.getNotificationSettings(),
        settings.getActiveUsersChartPeriod(),
        settings.getPlayerStatsRoundsWindow(),
      ]);
      res.status(200).json({ maintenanceMode, selfRegistrationEnabled, notifications, activeUsersChartPeriod, playerStatsRoundsWindow });
    } catch (err) {
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

  router.put("/admin/settings/active-users-chart-period", ...requireAdmin, async (req, res, next) => {
    try {
      const { value } = req.body as Record<string, unknown>;
      if (typeof value !== "string" || !ACTIVE_USERS_CHART_PERIODS.includes(value as ActiveUsersChartPeriod)) {
        res.status(400).json({ error: `value must be one of ${ACTIVE_USERS_CHART_PERIODS.join(", ")}` });
        return;
      }
      await settings.setActiveUsersChartPeriod(value as ActiveUsersChartPeriod, req.identity!.sub);
      res.status(200).json({ activeUsersChartPeriod: value });
    } catch (err) {
      next(err);
    }
  });

  router.put("/admin/settings/player-stats-rounds-window", ...requireAdmin, async (req, res, next) => {
    try {
      const { value } = req.body as Record<string, unknown>;
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < PLAYER_STATS_ROUNDS_WINDOW_MIN ||
        value > PLAYER_STATS_ROUNDS_WINDOW_MAX
      ) {
        res.status(400).json({ error: `value must be an integer between ${PLAYER_STATS_ROUNDS_WINDOW_MIN} and ${PLAYER_STATS_ROUNDS_WINDOW_MAX}` });
        return;
      }
      await settings.setPlayerStatsRoundsWindow(value, req.identity!.sub);
      res.status(200).json({ playerStatsRoundsWindow: value });
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
