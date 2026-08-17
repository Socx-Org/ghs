# deploy/

`ENG-050.4` requires project-specific deployment configuration to live in a dedicated top-level directory, separate from application source. This holds GHS's own filled-in copies (systemd units, nginx site config, CI workflow, deploy/rollback scripts) once Phase 3 (Infrastructure Alignment) provisions them — never a re-implementation of the canonical pattern itself.

The canonical templates this directory's contents will be copied and adapted from live in `socx-platform`, each in its own reference implementation, and are not duplicated here:

- `reference/systemd` — service and timer units
- `reference/nginx` — edge/site configuration
- `reference/github` — CI/CD workflow, branch protection
- `reference/deployment` — deploy/rollback scripts, backup script
- `reference/security` — `.env.example`, credential provisioning
- `reference/terraform` — infrastructure-as-code

## API versioning & the frontend split (ghs#57, Phase 6a)

`nginx-ghs.conf` splits the domain into three locations: `/api/` (proxied to the API process, full path preserved — the application itself owns the `/api/v1` version boundary internally, so a future `/api/v2` needs no nginx change), `/healthz` (the same process, unversioned), and `/` (the built React SPA once Phase 6b ships, served as static files from `/var/www/ghs` with an `index.html` fallback for client-side routing). This extends `reference/nginx`'s single-upstream template rather than replacing it — the shared template itself is unchanged; the pattern is RMS's own real, already-deployed split (`infra/nginx/rms-prod-lab-01.conf` in the `rms` repo), adapted to GHS's ports/paths.
