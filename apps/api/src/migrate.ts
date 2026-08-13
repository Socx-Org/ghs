import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createPool } from "./data/pool.ts";
import { applyMigrations } from "./data/migrations/apply.ts";

// Production migration runner (ghs#35, Phase 3) -- a deliberate, manually
// triggered step (`npm run migrate`, or `node dist/migrate.js` directly),
// not folded into the automatic deploy path (reference/deployment's
// deploy-release.sh only restarts services and health-gates; it doesn't
// touch schema). Matches the same convention RMS already established with
// its own infra/scripts/apply-migration.sh. Reuses applyMigrations() --
// the same function the test suite's own database setup calls -- so
// there is exactly one migration-application implementation, not two.
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
