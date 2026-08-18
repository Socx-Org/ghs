# GHS — Golf Handicap System

Real-world golf handicap management: clubs, courses, rounds, and World Handicap System (WHS) handicap calculation.

Part of the SOCX Application Modernisation programme, redeveloped under the SOCX Engineering Platform's governance (`socx-platform`). Rebuilt as a new application informed by the legacy GHS codebase's domain knowledge, not migrated from it — see the platform's GHS Clean-Slate Discovery for the reasoning.

## Status

Live at [ghs.socx.org.uk](https://ghs.socx.org.uk). Phases 0–2 complete: real domain logic (WHS handicap calculation, scoring, PCC, round approval/rejection/amendment workflow, notification outbox write path) and Phase 3 (Infrastructure Alignment) deploying it to production as a real, versioned `systemd` service. See the repository's Issues for the full redevelopment roadmap and what's still ahead (Phase 4 onward).

## Development

Follows `socx-platform`'s development workflow (`docs/development/github-workflow.md`, `ENG-070`) by reference — see `CLAUDE.md`.

```
npm install
npm test --workspaces --if-present
npm run build --workspaces --if-present
```

### Running locally

Requires a local Postgres instance (any recent version) reachable on `localhost:5432`.

```
npm install
npm run dev
```

Starts the API (`:3000`) and the web dev server (`:5173`) together. On first run it creates `.env` (real, locally-generated secrets — see `.env.example` for what each variable is) and the `ghs_dev` database automatically; both are left untouched on subsequent runs. `Ctrl-C` stops both. `apps/worker` isn't included — run it separately (`npm run dev --workspace apps/worker`) if you need it.

## License

Proprietary — see `LICENSE`. Not open source.
