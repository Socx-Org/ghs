// The real implementation lives in src/data/migrations/apply.ts (ghs#35),
// shared with the production migration runner (src/migrate.ts) so there's
// one implementation, not two. Re-exported here, unchanged, so every
// existing test's import path keeps working.
export { applyMigrations } from "../../src/data/migrations/apply.ts";
