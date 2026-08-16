import { rateLimit, ipKeyGenerator, MINUTE, HOUR } from "express-rate-limit";
import type { RequestHandler } from "express";

// ghs#49 (Phase 5 -- Security Hardening). Classified GHS-specific during
// discovery: no ADR or shared platform component exists, and
// reference/nginx's own README explicitly delegates "rate limiting...
// specific to one app" to each consuming project's own customisation.
// RMS's own real, working precedent (express-rate-limit, application-
// level, not edge) is informative, not copied -- these tiers are sized to
// GHS's own endpoint surface (see createApp's own comment for why the
// sensitive-action tier goes further than RMS's design).
//
// In-memory store (express-rate-limit's own default) -- an explicit
// architectural assumption, not a silent gap: GHS runs as a single
// ghs-api.service instance today, so per-process in-memory counters are
// sufficient. Horizontal scaling to multiple API instances would require
// a shared store (e.g. Redis) instead -- deliberately not introduced in
// this phase (platform owner decision, ghs#49).
//
// Every numeric value below is an initial operational value, not fixed
// architecture -- named constants specifically so they're easy to retune
// from real operational evidence without a design change. Each factory
// also accepts an optional override of the same shape, used only by this
// issue's own real request-flood tests (real production wiring in app.ts
// always calls these with no arguments, i.e. the real values below) --
// firing hundreds of real HTTP requests to prove a 300-request threshold
// would make the test suite slow for no real benefit; a small overridden
// threshold proves the exact same mechanism.

export interface RateLimitTierOverride {
  windowMs?: number;
  limit?: number;
}

const GENERAL_API_WINDOW_MS = 15 * MINUTE;
const GENERAL_API_LIMIT = 300;

const AUTH_TIER_WINDOW_MS = 15 * MINUTE;
const AUTH_TIER_LIMIT = 20;

const SENSITIVE_ACTION_IP_WINDOW_MS = HOUR;
const SENSITIVE_ACTION_IP_LIMIT = 10;
const SENSITIVE_ACTION_EMAIL_WINDOW_MS = HOUR;
const SENSITIVE_ACTION_EMAIL_LIMIT = 3;

// A fresh limiter (and its own in-memory counters) per createApp() call --
// deliberate, not an oversight: each test that builds its own app via
// createApp() gets an isolated counter, matching this codebase's existing
// per-test fake/service construction convention. In production there is
// exactly one createApp() call at startup, so this has no different
// effect there.

export function createGeneralApiLimiter(override: RateLimitTierOverride = {}): RequestHandler {
  return rateLimit({
    windowMs: override.windowMs ?? GENERAL_API_WINDOW_MS,
    limit: override.limit ?? GENERAL_API_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    // /healthz is an infrastructure liveness probe -- must never be
    // inadvertently throttled (ghs#49's own explicit acceptance
    // criterion). Belt-and-braces alongside app.ts's own mount order
    // (healthRouter is mounted before this limiter, so a healthy request
    // never even reaches it); this skip is the real guarantee, immune to
    // a future reordering of app.use() calls.
    skip: (req) => req.path === "/healthz",
    message: { error: "too many requests" },
  });
}

export function createAuthTierLimiter(override: RateLimitTierOverride = {}): RequestHandler {
  return rateLimit({
    windowMs: override.windowMs ?? AUTH_TIER_WINDOW_MS,
    limit: override.limit ?? AUTH_TIER_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many authentication attempts" },
  });
}

// Sensitive-action tier: resend-activation and password-reset/request
// both trigger a real email send to a third party's inbox -- their abuse
// cost extends beyond the requester alone. Dual-keyed: two independent
// limiters, both must pass. The IP-keyed one bounds a single source
// hammering many targets; the email-keyed one bounds a single victim's
// inbox being flooded from many different source IPs -- a real
// improvement over RMS's own design (RMS only email-keys its one resend
// endpoint, with no IP layer at all, and nothing on password-reset).
// Both instances are shared across both routes (createApp mounts the
// SAME two instances at both paths) -- one combined budget, not one each
// per route, so an attacker can't double their effective budget by
// splitting requests between the two actions.

export function createSensitiveActionIpLimiter(override: RateLimitTierOverride = {}): RequestHandler {
  return rateLimit({
    windowMs: override.windowMs ?? SENSITIVE_ACTION_IP_WINDOW_MS,
    limit: override.limit ?? SENSITIVE_ACTION_IP_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests -- try again later" },
  });
}

export function createSensitiveActionEmailLimiter(override: RateLimitTierOverride = {}): RequestHandler {
  return rateLimit({
    windowMs: override.windowMs ?? SENSITIVE_ACTION_EMAIL_WINDOW_MS,
    limit: override.limit ?? SENSITIVE_ACTION_EMAIL_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = req.body as Record<string, unknown> | undefined;
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : undefined;
      // Falls back to a real, IPv6-safe IP key (express-rate-limit's own
      // helper -- never a bare req.ip, which the library's own docs warn
      // can bypass IPv6 subnet grouping) when no email is present in the
      // body. The route's own validation separately rejects a missing
      // email with 400; this limiter still needs to produce a stable key
      // rather than crash or silently exempt malformed requests from
      // ever being counted.
      return email ?? ipKeyGenerator(req.ip ?? "unknown");
    },
    message: { error: "too many requests for this account -- try again later" },
  });
}
