import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { applyMigrations, checkMigrationDrift } from "../src/data/migrations/apply.ts";

// ghs#71 -- Migration Runner: Introduce Migration Ledger and Apply-Once
// Semantics. Every test here is behavioural against a real Postgres and
// (for the failure/checksum/idempotency cases) a real, fully isolated
// temporary migrations directory -- never a spy/mock on applyMigrations
// itself, and never a write into this repository's real
// src/data/migrations/ files.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const REAL_MIGRATIONS_DIR = fileURLToPath(new URL("../src/data/migrations/", import.meta.url));

before(async () => {
  await applyMigrations(pool);
});

after(async () => {
  await pool.end();
});

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function checksumAllRealMigrations(): Map<string, string> {
  const files = readdirSync(REAL_MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  return new Map(files.map((f) => [f, checksumOf(readFileSync(join(REAL_MIGRATIONS_DIR, f), "utf8"))]));
}

interface LedgerRow {
  filename: string;
  checksum: string;
  applied_at: Date;
}

async function ledgerRow(filename: string): Promise<LedgerRow | null> {
  const { rows } = await pool.query<LedgerRow>(
    "SELECT filename, checksum, applied_at FROM schema_migrations WHERE filename = $1",
    [filename],
  );
  return rows[0] ?? null;
}

async function cleanupLedgerRow(filename: string): Promise<void> {
  await pool.query("DELETE FROM schema_migrations WHERE filename = $1", [filename]);
}

// A fresh, real temp directory per test -- never the real migrations
// directory -- so the failure/checksum-mutation tests below can never
// touch or leak into this repository's own migration files.
function makeFixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ghs-migrations-test-"));
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql, "utf8");
  }
  return dir;
}

// ---------------------------------------------------------------------
// Real migration set
// ---------------------------------------------------------------------

test("applying the real migration set populates the ledger with a valid checksum per file", async () => {
  const row = await ledgerRow("001_clubs_and_courses.sql");
  assert.ok(row, "001 should be recorded in the ledger");
  assert.equal(row.checksum.length, 64, "sha256 hex digest is 64 characters");
});

test("an already-applied real migration is not re-executed on a second applyMigrations() call", async () => {
  const before1 = await ledgerRow("001_clubs_and_courses.sql");
  assert.ok(before1);

  await applyMigrations(pool);

  const after1 = await ledgerRow("001_clubs_and_courses.sql");
  assert.ok(after1);
  // Behavioural, not a spy/count: filename is the ledger's primary key,
  // so a real re-execution would either insert a fresh row (a new
  // applied_at) or throw a primary-key violation. Neither happened.
  assert.equal(after1.applied_at.getTime(), before1.applied_at.getTime(), "applied_at is unchanged -- the migration's own SQL and its ledger INSERT never ran a second time");

  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM schema_migrations WHERE filename = $1",
    ["001_clubs_and_courses.sql"],
  );
  assert.equal(rows[0]!.n, 1, "exactly one ledger row -- no duplicate insert was attempted");
});

// ---------------------------------------------------------------------
// Bootstrap: existing database, no ledger yet
// ---------------------------------------------------------------------

test("bootstrap: a database with historical migrations already applied but no ledger yet safely acquires the ledger, without modifying any historical migration file", async () => {
  const before1 = checksumAllRealMigrations();

  // Simulate "already migrated, no ledger yet" -- drop ONLY the ledger
  // table, leaving every real table/constraint/data exactly as a real,
  // already-migrated production database would have it.
  await pool.query("DROP TABLE IF EXISTS schema_migrations");

  await applyMigrations(pool); // no special bootstrap code path -- the normal apply-and-record loop

  const after1 = checksumAllRealMigrations();
  assert.deepEqual(after1, before1, "no historical migration file's on-disk contents changed during bootstrap");

  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations ORDER BY filename");
  assert.deepEqual(rows.map((r) => r.filename), [...before1.keys()], "every real migration file is recorded in the freshly-bootstrapped ledger");

  const clubsCheck = await pool.query<{ exists: string | null }>("SELECT to_regclass('clubs')::text AS exists");
  assert.ok(clubsCheck.rows[0]!.exists, "real schema is intact after bootstrap, not rebuilt from scratch");
});

// ---------------------------------------------------------------------
// Isolated fixture migrations -- never touch the real migrations dir
// ---------------------------------------------------------------------

test("a successful fixture migration is recorded, and is not re-executed on a second applyMigrations() call against the same directory", async () => {
  const filename = "test-idempotent-fixture.sql";
  const dir = makeFixtureDir({ [filename]: "CREATE TABLE IF NOT EXISTS _ghs_test_idempotent_marker (id INT);" });

  try {
    await applyMigrations(pool, dir);
    const first = await ledgerRow(filename);
    assert.ok(first, "a genuinely successful migration must be recorded");

    await applyMigrations(pool, dir);
    const second = await ledgerRow(filename);
    assert.equal(second!.applied_at.getTime(), first.applied_at.getTime(), "not re-executed the second time");

    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations WHERE filename = $1", [filename]);
    assert.equal(rows[0]!.n, 1);
  } finally {
    await pool.query("DROP TABLE IF EXISTS _ghs_test_idempotent_marker");
    rmSync(dir, { recursive: true, force: true });
    await cleanupLedgerRow(filename);
  }
});

test("a failed migration is not recorded in the ledger, and a subsequent applyMigrations() call retries it", async () => {
  const filename = "test-failure-fixture.sql";
  // A guaranteed, deterministic Postgres error with zero schema/data
  // side effects, regardless of what else is in the database.
  const dir = makeFixtureDir({ [filename]: "SELECT 1/0;" });

  try {
    await assert.rejects(() => applyMigrations(pool, dir), /division by zero/);
    assert.equal(await ledgerRow(filename), null, "a failed migration must never be recorded as applied");

    // Retried, not silently skipped -- the exact same failure recurs.
    await assert.rejects(() => applyMigrations(pool, dir), /division by zero/);
    assert.equal(await ledgerRow(filename), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await cleanupLedgerRow(filename);
  }
});

test("fixing a previously-failing migration file lets a subsequent applyMigrations() call apply and record it normally", async () => {
  const filename = "test-recovery-fixture.sql";
  const dir = makeFixtureDir({ [filename]: "SELECT 1/0;" });

  try {
    await assert.rejects(() => applyMigrations(pool, dir));
    assert.equal(await ledgerRow(filename), null);

    // Same filename, now genuinely fixed.
    writeFileSync(join(dir, filename), "CREATE TABLE IF NOT EXISTS _ghs_test_recovery_marker (id INT);", "utf8");

    await applyMigrations(pool, dir);
    assert.ok(await ledgerRow(filename), "the fixed migration is applied and recorded on the next run");
  } finally {
    await pool.query("DROP TABLE IF EXISTS _ghs_test_recovery_marker");
    rmSync(dir, { recursive: true, force: true });
    await cleanupLedgerRow(filename);
  }
});

test("a previously-applied migration file whose on-disk contents change after being recorded fails loudly on the next applyMigrations() call, rather than being silently re-applied or ignored", async () => {
  const filename = "test-checksum-fixture.sql";
  const original = "CREATE TABLE IF NOT EXISTS _ghs_test_checksum_marker (id INT);";
  const dir = makeFixtureDir({ [filename]: original });

  try {
    await applyMigrations(pool, dir);
    const recorded = await ledgerRow(filename);
    assert.equal(recorded!.checksum, checksumOf(original));

    // Mutate the file on disk after it's already been recorded --
    // simulates an edit to a historical migration, which this
    // repository's own convention (migration 010's comment) says must
    // never happen.
    writeFileSync(join(dir, filename), original + "\n-- mutated after being applied\n", "utf8");

    await assert.rejects(
      () => applyMigrations(pool, dir),
      /modified after being applied/,
      "a changed historical migration file must be detected and rejected, not silently re-applied or skipped",
    );

    // The ledger's own record of the original checksum is untouched --
    // the rejected run did not overwrite it.
    const stillRecorded = await ledgerRow(filename);
    assert.equal(stillRecorded!.checksum, checksumOf(original));
  } finally {
    await pool.query("DROP TABLE IF EXISTS _ghs_test_checksum_marker");
    rmSync(dir, { recursive: true, force: true });
    await cleanupLedgerRow(filename);
  }
});

// ---------------------------------------------------------------------
// checkMigrationDrift (ghs#154) -- read-only, never DDL, never throws
// ---------------------------------------------------------------------

test("reports no pending files once every real migration has actually been applied", async () => {
  await applyMigrations(pool); // this file's own before() already did this; explicit here for clarity
  const report = await checkMigrationDrift(pool);
  assert.deepEqual(report.pendingFiles, []);
});

test("reports a file on disk that hasn't been applied yet as pending, and nothing else", async () => {
  const appliedFilename = "test-drift-applied.sql";
  const pendingFilename = "test-drift-pending.sql";
  const dir = makeFixtureDir({
    [appliedFilename]: "CREATE TABLE IF NOT EXISTS _ghs_test_drift_marker (id INT);",
  });

  try {
    await applyMigrations(pool, dir);
    assert.ok(await ledgerRow(appliedFilename), "the applied fixture must actually be recorded");

    // Added to disk AFTER applyMigrations already ran against this
    // directory -- simulates exactly ghs#154's real scenario: new code
    // (and its migration file) is live, but the manual `npm run
    // migrate` step covering it hasn't run yet.
    writeFileSync(join(dir, pendingFilename), "CREATE TABLE IF NOT EXISTS _ghs_test_drift_marker_2 (id INT);", "utf8");

    const report = await checkMigrationDrift(pool, dir);
    assert.deepEqual(report.pendingFiles, [pendingFilename], "only the never-applied file is reported, not the already-applied one");
  } finally {
    await pool.query("DROP TABLE IF EXISTS _ghs_test_drift_marker");
    await pool.query("DROP TABLE IF EXISTS _ghs_test_drift_marker_2");
    rmSync(dir, { recursive: true, force: true });
    await cleanupLedgerRow(appliedFilename);
  }
});

test("reports every real migration file as pending, without throwing, when schema_migrations itself doesn't exist yet", async () => {
  const realFiles = [...checksumAllRealMigrations().keys()];

  // Simulates a database that has never had migrate.ts run against it
  // at all -- not just missing the newest migration.
  await pool.query("DROP TABLE IF EXISTS schema_migrations");
  try {
    const report = await checkMigrationDrift(pool);
    assert.deepEqual(report.pendingFiles.sort(), realFiles.sort(), "every real migration file is reported pending, not just the most recent");
  } finally {
    // Restore the ledger before any later test in this file (or another
    // file, given --test-concurrency=1) runs -- same restore-in-place
    // convention as the bootstrap test above.
    await applyMigrations(pool);
  }
});
