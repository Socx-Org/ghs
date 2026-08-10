import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool } from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "data", "migrations");

// Fixed advisory-lock key for migration application -- arbitrary, but
// stable and unique to this purpose within the database.
const MIGRATION_LOCK_KEY = 727_274;

// Applies every migration file in filename order (ADR-200: versioned,
// applied-in-order SQL migration files, no specific tool mandated). Files
// use IF NOT EXISTS throughout (matching legacy GHS's own real, proven
// convention) -- but IF NOT EXISTS alone is not safe under true
// concurrency: Node's test runner runs separate test files' before()
// hooks concurrently by default, and two concurrent `CREATE TABLE IF NOT
// EXISTS` statements can race on Postgres's own system catalog, found for
// real while running this phase's two integration test files together
// (`duplicate key value violates unique constraint
// "pg_type_typname_nsp_index"`). A session-level advisory lock serialises
// concurrent callers so only one applies migrations at a time; others
// block until it's done, then find nothing left to do.
export async function applyMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      await client.query(sql);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    client.release();
  }
}
