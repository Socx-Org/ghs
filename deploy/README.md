# deploy/

`ENG-050.4` requires project-specific deployment configuration to live in a dedicated top-level directory, separate from application source. This holds GHS's own filled-in copies (systemd units, nginx site config, CI workflow, deploy/rollback scripts) once Phase 3 (Infrastructure Alignment) provisions them — never a re-implementation of the canonical pattern itself.

The canonical templates this directory's contents will be copied and adapted from live in `socx-platform`, each in its own reference implementation, and are not duplicated here:

- `reference/systemd` — service and timer units
- `reference/nginx` — edge/site configuration
- `reference/github` — CI/CD workflow, branch protection
- `reference/deployment` — deploy/rollback scripts, backup script
- `reference/security` — `.env.example`, credential provisioning
- `reference/terraform` — infrastructure-as-code

## API versioning & the frontend split (ghs#57, ghs#62)

`nginx-ghs.conf` splits the domain into three locations: `/api/` (proxied to the API process, full path preserved — the application itself owns the `/api/v1` version boundary internally, so a future `/api/v2` needs no nginx change), `/healthz` (the same process, unversioned), and `/` (the built React SPA, served as static files from `/var/www/ghs` with an `index.html` fallback for client-side routing). This extends `reference/nginx`'s single-upstream template rather than replacing it — the shared template itself is unchanged; the pattern is RMS's own real, already-deployed split (`infra/nginx/rms-prod-lab-01.conf` in the `rms` repo), adapted to GHS's ports/paths.

## Frontend build & deploy (ghs#62, Phase 6b)

`apps/web`'s production build (`vite build`, producing `apps/web/dist`) is included in the same release tarball as the API/worker for a single versioned artifact, but deployed differently — it's a static bundle, not a Node process, so it's never one of `deploy-release.sh`'s `SERVICES=` (nothing to restart, no systemd unit). After the API/worker release symlink flips, a separate `rsync -a --delete` step in `ci.yml`'s deploy job copies `/opt/ghs/current/apps/web/dist/` to `/var/www/ghs/` — the directory `nginx-ghs.conf`'s `/` location actually serves from. This split exists because `/opt/ghs/current` is `750 ghs:ghs` (`reference/systemd`'s own hardening), unreadable to nginx's `www-data`. The rsync is deliberately not perfectly atomic with the API/worker swap — acceptable for static assets, where a stale bundle for a few seconds is much lower-risk than for the API. Matches RMS's own real, already-deployed mechanism exactly (`.github/workflows/deploy.yml` in the `rms` repo).

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
