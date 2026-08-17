import express, { Router } from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { Logger } from "../../logger.ts";
import type { ClubsService } from "../../application/clubs.service.ts";
import type { CoursesService } from "../../application/courses.service.ts";
import type { AuthService } from "../../application/auth.service.ts";
import type { MfaService } from "../../application/mfa.service.ts";
import type { AdminUsersService } from "../../application/admin-users.service.ts";
import type { SystemSettingsService } from "../../application/system-settings.service.ts";
import type { RoundsService } from "../../application/rounds.service.ts";
import type { HandicapOverridesService } from "../../application/handicap-overrides.service.ts";
import type { PccService } from "../../application/pcc.service.ts";
import type { PlayersRepository } from "../../data/players.repository.ts";
import type { AuthProvider } from "../../application/auth-provider.ts";
import {
  createGeneralApiLimiter,
  createAuthTierLimiter,
  createSensitiveActionIpLimiter,
  createSensitiveActionEmailLimiter,
} from "./middleware/rate-limit.ts";
import type { RateLimitTierOverride } from "./middleware/rate-limit.ts";
import { healthRouter } from "./routes/health.ts";
import { clubsRouter } from "./routes/clubs.ts";
import { coursesRouter } from "./routes/courses.ts";
import { authRouter } from "./routes/auth.ts";
import { mfaRouter } from "./routes/mfa.ts";
import { adminUsersRouter } from "./routes/admin-users.ts";
import { adminSettingsRouter } from "./routes/admin-settings.ts";
import { adminPccRouter } from "./routes/admin-pcc.ts";
import { roundsRouter } from "./routes/rounds.ts";
import { handicapOverridesRouter } from "./routes/handicap-overrides.ts";

export interface AppDeps {
  logger: Logger;
  clubsService: ClubsService;
  coursesService: CoursesService;
  authService: AuthService;
  mfaService: MfaService;
  adminUsersService: AdminUsersService;
  systemSettingsService: SystemSettingsService;
  roundsService: RoundsService;
  handicapOverridesService: HandicapOverridesService;
  pccService: PccService;
  playersRepository: PlayersRepository;
  authProvider: AuthProvider;
  // ghs#49: real production wiring never sets this (undefined -- every
  // tier uses its real operational value, defined once in rate-limit.ts).
  // Exists solely so this issue's own request-flood tests can build the
  // real app, through this same real composition root, with small
  // thresholds -- proving hundreds of real requests against a
  // production-sized 300 limit would make the suite slow for no benefit
  // a small override doesn't already prove.
  rateLimitOverrides?: {
    general?: RateLimitTierOverride;
    auth?: RateLimitTierOverride;
    sensitiveIp?: RateLimitTierOverride;
    sensitiveEmail?: RateLimitTierOverride;
  };
}

// Composition root for the interface layer -- wires routers, never touches
// persistence directly (ADR-060).
export function createApp(deps: AppDeps): Express {
  const app = express();

  // ghs#49: GHS runs behind nginx (Phase 3, reference/nginx) -- exactly
  // one hop, same host (nginx proxies to 127.0.0.1:{{APP_PORT}}, per
  // reference/nginx's own topology; deploy/nginx-ghs.conf's own
  // proxy_set_header X-Forwarded-For confirms this is already set
  // correctly on the nginx side). "loopback" trusts requests
  // originating from 127.0.0.1/::1 and reads the real client IP from
  // X-Forwarded-For. Without this, every production request would
  // appear to Express as coming from nginx's own local IP, collapsing
  // every real client into a single shared rate-limit bucket -- found
  // and fixed as a real prerequisite for rate limiting to work in
  // production at all, not assumed to already be configured.
  app.set("trust proxy", "loopback");

  app.use(express.json());

  app.use((req, _res, next) => {
    deps.logger.info("request received", { method: req.method, path: req.path });
    next();
  });

  // /healthz stays outside the versioned API entirely -- an
  // infrastructure liveness probe, not an application-API concern, and
  // deliberately never renumbered by a future /api/v2 (ghs#57). Mounted
  // directly on app, before v1Router below, so Express never even
  // considers v1Router (or anything mounted on it, including the rate
  // limiters) for a /healthz request.
  app.use(healthRouter());

  // ghs#57: every application API route lives under /api/v1 -- an
  // intentional versioning boundary (a future /api/v2 can be added as a
  // sibling router here without touching any existing route module's
  // own internal paths, all of which are unchanged by this issue). Every
  // router below already declares its own full path internally (e.g.
  // auth.ts has router.post("/auth/register", ...)), so mounting them
  // unchanged onto v1Router and then mounting v1Router at /api/v1 is the
  // entire change -- no route module's path strings were touched.
  const v1Router = Router();

  // General API baseline -- mounted first on v1Router, before every
  // other route, so everything else under /api/v1 is covered by the
  // broad, outer tier. The auth and sensitive-action tiers below are
  // layered ON TOP of this for the paths they cover, not an alternative
  // to it -- each request to /auth/resend-activation, for example, is
  // independently checked against all three, and any one being exceeded
  // is enough to reject.
  v1Router.use(createGeneralApiLimiter(deps.rateLimitOverrides?.general));

  v1Router.use("/auth", createAuthTierLimiter(deps.rateLimitOverrides?.auth));
  const sensitiveActionIpLimiter = createSensitiveActionIpLimiter(deps.rateLimitOverrides?.sensitiveIp);
  const sensitiveActionEmailLimiter = createSensitiveActionEmailLimiter(deps.rateLimitOverrides?.sensitiveEmail);
  v1Router.use("/auth/resend-activation", sensitiveActionIpLimiter, sensitiveActionEmailLimiter);
  v1Router.use("/auth/password-reset/request", sensitiveActionIpLimiter, sensitiveActionEmailLimiter);

  v1Router.use(authRouter(deps.authService, deps.systemSettingsService));
  v1Router.use(mfaRouter(deps.mfaService, deps.authProvider));
  v1Router.use(adminUsersRouter(deps.adminUsersService, deps.mfaService, deps.authProvider));
  v1Router.use(adminSettingsRouter(deps.systemSettingsService, deps.authProvider));
  v1Router.use(adminPccRouter(deps.pccService, deps.authProvider));
  v1Router.use(clubsRouter(deps.clubsService, deps.authProvider));
  v1Router.use(coursesRouter(deps.coursesService, deps.authProvider));
  v1Router.use(roundsRouter(deps.roundsService, deps.playersRepository, deps.authProvider));
  v1Router.use(handicapOverridesRouter(deps.handicapOverridesService, deps.playersRepository, deps.authProvider));

  app.use("/api/v1", v1Router);

  // Centralised error handling -- errors from any route are logged
  // structurally (OPS-050.3: never the raw request body, which may contain
  // sensitive fields) and never leak an internal message to the client.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    deps.logger.error("unhandled request error", { error: err.message });
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
