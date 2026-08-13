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
  logger.error("migration failed", { error: (err as Error).message });
  process.exitCode = 1;
} finally {
  await pool.end();
}
