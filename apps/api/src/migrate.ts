import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createPool } from "./data/pool.ts";
import { applyMigrations } from "./data/migrations/apply.ts";

// Production migration runner (ghs#35, Phase 3). Originally a deliberate,
// manually triggered step (`npm run migrate`, or `node dist/migrate.js`
// directly) -- ghs#217 automated that trigger into the CI deploy job
// itself (a new step, run against /opt/ghs/current, after
// reference/deployment's deploy-release.sh has already extracted the
// release and health-gated the restart -- that script still has no
// concept of migrations of its own; the automation lives one layer up,
// in ghs's own ci.yml). `npm run migrate`/`node dist/migrate.js` still
// work identically for a manual/out-of-band run (e.g. local dev) --
// nothing about this entry point itself changed, only who calls it and
// when. Reuses applyMigrations() -- the same function the test suite's
// own database setup calls -- so there is exactly one migration-
// application implementation, not two.
const logger = createLogger("ghs-migrate");
const config = loadConfig();
const pool = createPool(config.database);

try {
  await applyMigrations(pool);
  logger.info("migrations applied");
} catch (err) {
  // Normalized rather than a blind `(err as Error).message` -- a
  // non-Error throw would otherwise log "undefined" and lose whatever
  // was actually thrown. Stack included (not just the message) since
  // this runs unsupervised, one-off, against production -- the extra
  // debuggability matters more here than for a request-path error
  // (caught in review, PR #37).
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error("migration failed", { error: message, stack });
  process.exitCode = 1;
} finally {
  await pool.end();
}
