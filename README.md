# GHS — Golf Handicap System

Real-world golf handicap management: clubs, courses, rounds, and World Handicap System (WHS) handicap calculation.

Part of the SOCX Application Modernisation programme, redeveloped under the SOCX Engineering Platform's governance (`socx-platform`). Rebuilt as a new application informed by the legacy GHS codebase's domain knowledge, not migrated from it — see the platform's GHS Clean-Slate Discovery for the reasoning.

## Status

Phase 0 (Foundation) — scaffold only, matching `socx-platform`'s `reference/application` pattern. No real domain logic yet; see the repository's Issues for the full redevelopment roadmap.

## Development

Follows `socx-platform`'s development workflow (`docs/development/github-workflow.md`, `ENG-070`) by reference — see `CLAUDE.md`.

```
npm install
npm test --workspaces --if-present
npm run build --workspaces --if-present
```

## License

Proprietary — see `LICENSE`. Not open source.
