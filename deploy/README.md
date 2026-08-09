# deploy/

`ENG-050.4` requires project-specific deployment configuration to live in a dedicated top-level directory, separate from application source. This holds GHS's own filled-in copies (systemd units, nginx site config, CI workflow, deploy/rollback scripts) once Phase 3 (Infrastructure Alignment) provisions them — never a re-implementation of the canonical pattern itself.

The canonical templates this directory's contents will be copied and adapted from live in `socx-platform`, each in its own reference implementation, and are not duplicated here:

- `reference/systemd` — service and timer units
- `reference/nginx` — edge/site configuration
- `reference/github` — CI/CD workflow, branch protection
- `reference/deployment` — deploy/rollback scripts, backup script
- `reference/security` — `.env.example`, credential provisioning
- `reference/terraform` — infrastructure-as-code
