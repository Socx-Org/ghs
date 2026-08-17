import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool, PoolClient } from "pg";

const DEFAULT_MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url));

// Fixed advisory-lock key for migration application -- arbitrary, but
// stable and unique to this purpose within the database.
const MIGRATION_LOCK_KEY = 727_274;

// ghs#71: a real ledger, not the "replay every file's full text,
// unconditionally, every time" model this replaces. Found and required
// while implementing ghs#58 (round draft/in-progress lifecycle): widening
// a CHECK constraint in a new migration is incompatible with an earlier
// migration (008) that also independently re-asserts its own, narrower
// definition of the same constraint on every replay -- once real data
// exists that only the later migration allows, replaying the earlier one
// fails outright, and since it runs first, the later one never gets a
// chance to fix it back. This is a real production hazard, not just a
// test artifact: `npm run migrate` (migrate.ts) is a manually-triggered
// full replay, and the next migration shipped after real data exists
// would hit the exact same failure.
//
// filename is the ledger's primary key -- the existing zero-padded
// numeric-prefix naming convention is already a deterministic, sortable
// identifier; no separate version-numbering scheme introduced.
//
// checksum enforces this repository's own existing migration convention
// (established in migration 010's own comment: migrations are an
// immutable, append-only record of what actually ran) -- this is GHS's
// own convention, not a requirement of ADR-200 itself, which only
// requires versioned, applied-in-order SQL migration files and is silent
// on replay/ledger mechanics. A mismatch (a previously-applied file's
// on-disk contents changed) fails loudly rather than silently proceeding.
const CREATE_LEDGER_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

interface LedgerRow {
  filename: string;
  checksum: string;
}

// Hashes exactly the same string that gets executed -- read once, as
// utf8 (the same encoding readFileSync already used for the query
// string below), with no separate re-read or transformation (e.g. no
// line-ending normalisation) between what's hashed and what's sent to
// Postgres. Deterministic across platforms/checkouts as a result.
function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

// Applies each not-yet-recorded file's own SQL and its ledger INSERT
// inside one transaction (matching this codebase's existing explicit
// BEGIN/COMMIT convention elsewhere, e.g. rounds.service.ts's
// runWorkflowTransition -- not string-concatenated with the migration's
// own content, which would be fragile against DO $$...$$ blocks). Any
// failure rolls both back together: a failed migration is never
// recorded, and the caller stops attempting further files.
async function applyAndRecord(client: PoolClient, filename: string, sql: string, checksum: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [filename, checksum]);
    await client.query("COMMIT");
  } catch (err) {
    // Best-effort only, same convention as the advisory-unlock below
    // (caught in review, PR #37, for the exact same reason): if the
    // migration's own SQL is what failed, ROLLBACK can itself throw
    // (e.g. a dropped connection) -- swallowed here so that secondary
    // failure can never replace and hide the real migration error the
    // caller needs to see.
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignored -- see comment above
    }
    throw err;
  }
}

// Bootstraps an existing database (001-010 already applied for real, no
// ledger yet) with no special-case code path: every currently-shipped
// migration is a safe no-op to replay one final time against data that
// already matches it (verified directly, ghs#71 -- every CREATE/ADD
// COLUMN/constraint statement is IF NOT EXISTS-guarded or matches
// current real data; the only non-DDL statements, 006's targeted DELETE
// and 010's backfill UPDATE/DELETE, have empty-match WHERE clauses after
// their first real run; nothing in the current migration set is
// otherwise non-idempotent). So the exact same apply-and-record loop
// used for steady-state operation naturally and safely acquires the
// ledger the first time it runs against an already-migrated database,
// with no historical migration file touched -- as long as it runs
// before any migration that would NOT be safe to replay against
// existing data ships (ghs#58's own migration is exactly that case,
// which is why this issue blocks it, not the other way around).
// migrationsDir: defaults to this repository's real migrations directory
// for every real caller (migrate.ts, apps/api's own test helper). Exists
// solely so ghs#71's own tests can point at a fully isolated, controlled
// fixture directory (a failed migration, a checksum-mismatched file) --
// without ever writing into or mutating the real migration files on
// disk during a test run. Same "optional override, defaults to real
// production behaviour" shape already established for
// AppDeps.rateLimitOverrides (ghs#49).
export async function applyMigrations(pool: Pool, migrationsDir: string = DEFAULT_MIGRATIONS_DIR): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await client.query(CREATE_LEDGER_TABLE);
      const { rows } = await client.query<LedgerRow>("SELECT filename, checksum FROM schema_migrations");
      const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const sql = readFileSync(join(migrationsDir, file), "utf8");
        const checksum = checksumOf(sql);

        const recordedChecksum = applied.get(file);
        if (recordedChecksum !== undefined) {
          if (recordedChecksum !== checksum) {
            throw new Error(
              `Migration ${file} was modified after being applied (checksum mismatch) -- ` +
                `this repository's migrations are an immutable, append-only record of what actually ran.`,
            );
          }
          continue;
        }

        await applyAndRecord(client, file, sql, checksum);
      }
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      } catch {
        // Best-effort only -- advisory locks are session-scoped and
        // release automatically once this client is returned to the pool
        // (or the connection closes), so a failed explicit unlock isn't
        // fatal. Swallowed here, not rethrown, so it can never mask a
        // real migration failure from the try block above (caught in
        // review, PR #37: the previous version let an unlock error
        // replace the original error, and skip client.release() below
        // entirely).
      }
    }
  } finally {
    client.release();
  }
}
