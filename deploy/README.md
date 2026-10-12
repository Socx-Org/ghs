# deploy/

`ENG-050.4` requires project-specific deployment configuration to live in a dedicated top-level directory, separate from application source. This holds GHS's own filled-in copies (systemd units, nginx site config, CI workflow, deploy/rollback scripts) once Phase 3 (Infrastructure Alignment) provisions them — never a re-implementation of the canonical pattern itself.

The canonical templates this directory's contents will be copied and adapted from live in `socx-platform`, each in its own reference implementation, and are not duplicated here:

- `reference/systemd` — service and timer units
- `reference/nginx` — edge/site configuration
- `reference/github` — CI/CD workflow, branch protection
- `reference/deployment` — deploy/rollback scripts, backup script
- `reference/security` — `.env.example`, credential provisioning
- `reference/terraform` — infrastructure-as-code

## Deploy pipeline secrets

`ci.yml`'s `deploy` job (its "Deploy to droplet" and "Run database migrations" steps) requires `DROPLET_HOST`, `DROPLET_HOST_KEY`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` as CI-provider secrets (`reference/deployment`'s own Prerequisites). `DROPLET_HOST_KEY` (ghs#219, socx-platform#108) is the droplet's real SSH host key — `ssh-keyscan {{DROPLET_HOST}}`'s own output, captured and verified out-of-band exactly once (e.g. against the fingerprint the hosting provider's own console/API shows), never a live `ssh-keyscan` result trusted with nothing to check it against. Pinned via `StrictHostKeyChecking=yes` rather than the previous `accept-new`, which trusted whatever host key it saw on first connection — a real gap on GitHub-hosted runners, where "first connection" is every single deploy, not a genuine one-time bootstrap. Without this secret configured, every deploy fails closed (a missing/empty `known_hosts` is a hard SSH refusal under `StrictHostKeyChecking=yes`), never silently falling back to trusting an unverified key.

Its "Refresh geo-IP database" step (ghs#234) additionally requires `MAXMIND_LICENSE_KEY` — a free MaxMind GeoLite2 account's license key (https://www.maxmind.com/en/geolite2/signup). Unlike the other four secrets above, this one's blast radius if ever exposed is low: it only grants permission to download MaxMind's own free, public database, nothing account- or infrastructure-sensitive. That's a deliberate choice over the alternative (download once locally, never store the key on the deploy pipeline at all) — refreshing on every deploy keeps country/region/city accuracy current for free, since IP-to-location mappings drift as address blocks get reallocated, and this repo already deploys often enough (ghs#217) for that refresh to cost nothing extra.

## Geo-IP database (ghs#234)

`login_attempts.country`/`region`/`city` are resolved from a local MaxMind GeoLite2-City `.mmdb` file — never a live third-party API call per login, so no IP (including a failed/malicious attempt's own) ever leaves this infrastructure. The file lives at `/opt/ghs/shared/geoip/GeoLite2-City.mmdb` — `/opt/ghs/shared`, not `/opt/ghs/releases/<version>`, because it must survive a release being replaced/rolled back, and re-downloading a ~50MB file on every single deploy for no reason would be wasteful. `ghs-api.service`'s own `GEOIP_DB_PATH` environment variable points at it; `apps/api/src/lib/geoip.ts` opens it once at process startup.

Graceful degradation is the core design constraint, not an edge case: a missing file (a brand-new environment's first-ever deploy, before this step has run once) or a failed refresh (MaxMind outage, an expired/revoked license key) must never crash startup or fail a deploy — every `country`/`region`/`city` just stays `null`, identical to this column's behaviour before ghs#234 shipped at all. The CI step enforces this itself: a download/extract failure is caught and logged as a warning, the deploy continues, and the API starts up against whatever database (if any) the previous successful refresh already left in place.

**Known gap, flagged for whoever runs the first real deploy after this lands:** the CI step's remote commands assume `$DEPLOY_USER` already has the same `sudo -u ghs <command>` privilege the existing "Run database migrations" step relies on (confirmed working there) — this hasn't been independently re-verified for the specific `mkdir`/`curl`/`tar`/`mv` sequence this new step runs. If the droplet's sudoers scopes `$DEPLOY_USER`'s sudo rights more narrowly than that existing step implies, this step will fail (loudly, in CI, as its own distinct step) without affecting the rest of the deploy — worth a manual SSH dry-run of the step's own commands before relying on it, if that's not already confirmed by the time this is read.

## API versioning & the frontend split (ghs#57, ghs#62)

`nginx-ghs.conf` splits the domain into three locations: `/api/` (proxied to the API process, full path preserved — the application itself owns the `/api/v1` version boundary internally, so a future `/api/v2` needs no nginx change), `/healthz` (the same process, unversioned), and `/` (the built React SPA, served as static files from `/var/www/ghs` with an `index.html` fallback for client-side routing). This extends `reference/nginx`'s single-upstream template rather than replacing it — the shared template itself is unchanged; the pattern is RMS's own real, already-deployed split (`infra/nginx/rms-prod-lab-01.conf` in the `rms` repo), adapted to GHS's ports/paths.

## Frontend build & deploy (ghs#62, Phase 6b)

`apps/web`'s production build (`vite build`, producing `apps/web/dist`) is included in the same release tarball as the API/worker for a single versioned artifact, but deployed differently — it's a static bundle, not a Node process, so it's never one of `deploy-release.sh`'s `SERVICES=` (nothing to restart, no systemd unit). After the API/worker release symlink flips, a separate `rsync -a --delete` step in `ci.yml`'s deploy job copies `/opt/ghs/current/apps/web/dist/` to `/var/www/ghs/` — the directory `nginx-ghs.conf`'s `/` location actually serves from. This split exists because `/opt/ghs/current` is `750 ghs:ghs` (`reference/systemd`'s own hardening), unreadable to nginx's `www-data`. The rsync is deliberately not perfectly atomic with the API/worker swap — acceptable for static assets, where a stale bundle for a few seconds is much lower-risk than for the API. Matches RMS's own real, already-deployed mechanism exactly (`.github/workflows/deploy.yml` in the `rms` repo).

## Database migrations on deploy (ghs#217)

`reference/deployment`'s `deploy-release.sh` has no concept of migrations at all — it only extracts a release, flips the `current` symlink, restarts services, and health-gates the restart. Running `node dist/migrate.js` from `apps/api` (which applies any not-yet-applied migration file, ledger-tracked and safely idempotent — `apps/api/src/data/migrations/apply.ts`) used to be a separate, manual ops step after every deploy that shipped a new migration: notice `ghs-api.service`'s own startup drift warning in `journalctl`, then SSH in and run it by hand with credentials read from `/etc/credentials/ghs/*`.

`ci.yml`'s deploy job now runs this automatically, in its own "Run database migrations" step, after `deploy-release.sh` has already extracted the release, flipped the symlink, restarted `ghs-api.service`/`ghs-worker.service`, and passed its own health gate. This was a deliberate choice over extending the shared `deploy-release.sh` itself (which would also need a platform-level decision, since RMS uses the same script) — the accepted trade-off is that the new release is already live and serving for a brief window before its own migration applies, acceptable given every migration shipped so far is additive/backward-compatible (`ADD COLUMN`, nullable, no destructive drops). `node dist/migrate.js` (or `npm run migrate`) still works identically for a manual/out-of-band run when needed (e.g. local dev) — only the automatic *trigger* changed, not the runner itself.

## Bootstrapping the first admin account (ghs#86)

`ghs#86`'s Admin Account Creation UI (`/admin/users/new`) requires an existing `admin`/`super_admin` to reach it at all — `POST /api/v1/admin/users` is itself behind `requireRole`, by design. That's a real chicken-and-egg gap for a brand-new environment: nothing in migrations or the application seeds a first account, so the very first admin has no UI path into existence. Deliberately **not** solved with a bootstrap script or seed migration — a one-time manual step, run once per environment, isn't worth the extra code path and its own security surface (a script that can silently create a `super_admin` is itself a real target). Documented here instead, as a real ops runbook step:

```sql
-- Run once per environment, directly against the database, after
-- migrations have been applied. Generate the hash first (matches
-- apps/api/src/lib/password.ts exactly -- argon2, ADR-120):
--
--   node --experimental-strip-types -e "
--     import argon2 from 'argon2';
--     console.log(await argon2.hash('<a real, unique password>'));
--   "

INSERT INTO users (email, password_hash, status, role, email_verified_at)
VALUES (
  '<real admin email>',
  '<argon2 hash from above>',
  'active',
  'super_admin',
  now()
);
```

Every admin account created after this one goes through the real `/admin/users/new` UI — this step exists solely to create the first one, and shouldn't be needed again unless every `super_admin`/`admin` row is somehow lost.

**As of 2026-08-18, production (`ghs.socx.org.uk`) has not had this step run yet — there is currently no real admin account in production**, and the Admin Account Creation UI is consequently unreachable there until it is.
