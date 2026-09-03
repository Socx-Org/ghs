import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createPresenceSnapshotsRepository } from "../src/data/presence-snapshots.repository.ts";
import { applyMigrations } from "./helpers/apply-migrations.ts";

// ghs#195: the bucketing SQL (generate_series + date_bin, zero-filled
// gaps) is genuinely new and non-trivial -- worth its own focused real-
// Postgres test, same precedent as courses.repository.integration.test.ts,
// rather than only ever being exercised indirectly through the Admin
// Dashboard route.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE presence_snapshots");
});

after(async () => {
  await pool.end();
});

async function insertSnapshotAt(timestamp: string, activeCount: number): Promise<void> {
  await pool.query("INSERT INTO presence_snapshots (snapshot_at, active_count) VALUES ($1, $2)", [timestamp, activeCount]);
}

test("hasAnySnapshot is false with no rows and true once one exists -- the dashboard's cold-start signal", async () => {
  const repo = createPresenceSnapshotsRepository(pool);
  assert.equal(await repo.hasAnySnapshot(), false);

  await repo.insertSnapshot(1);

  assert.equal(await repo.hasAnySnapshot(), true);
});

test("insertSnapshot writes a real row with the current timestamp", async () => {
  const repo = createPresenceSnapshotsRepository(pool);
  const before = Date.now();

  await repo.insertSnapshot(7);

  const result = await pool.query<{ snapshot_at: Date; active_count: number }>("SELECT snapshot_at, active_count FROM presence_snapshots");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.active_count, 7);
  assert.ok(result.rows[0]!.snapshot_at.getTime() >= before - 1000, "snapshot_at is real-time, not backdated");
});

test("getSeries zero-fills every bucket across the range when no snapshots exist at all", async () => {
  const repo = createPresenceSnapshotsRepository(pool);
  const rangeStart = new Date("2026-06-01T00:00:00.000Z");
  const rangeEnd = new Date("2026-06-01T01:00:00.000Z");

  const series = await repo.getSeries(rangeStart, rangeEnd, "15 minutes");

  assert.equal(series.length, 4);
  for (const point of series) {
    assert.equal(point.count, 0);
  }
  assert.equal(series[0]!.timestamp, "2026-06-01T00:00:00.000Z");
  assert.equal(series[3]!.timestamp, "2026-06-01T00:45:00.000Z");
});

test("getSeries averages real snapshots that fall inside each bucket, rounded to the nearest integer, and leaves buckets with no data at zero", async () => {
  const repo = createPresenceSnapshotsRepository(pool);
  // Two real snapshots in the first 15-minute bucket (avg 3 -> rounds to
  // 3), one in the third bucket, nothing in the second or fourth.
  await insertSnapshotAt("2026-06-01T00:02:00.000Z", 2);
  await insertSnapshotAt("2026-06-01T00:10:00.000Z", 4);
  await insertSnapshotAt("2026-06-01T00:31:00.000Z", 5);

  const series = await repo.getSeries(new Date("2026-06-01T00:00:00.000Z"), new Date("2026-06-01T01:00:00.000Z"), "15 minutes");

  assert.deepEqual(
    series.map((p) => p.count),
    [3, 0, 5, 0],
  );
});

test("getSeries excludes a snapshot exactly at rangeEnd -- the range is [start, end), same convention as every other range query in this codebase", async () => {
  const repo = createPresenceSnapshotsRepository(pool);
  const rangeStart = new Date("2026-06-01T00:00:00.000Z");
  const rangeEnd = new Date("2026-06-01T00:15:00.000Z");
  await insertSnapshotAt(rangeEnd.toISOString(), 9);

  const series = await repo.getSeries(rangeStart, rangeEnd, "15 minutes");

  assert.equal(series.length, 1);
  assert.equal(series[0]!.count, 0, "the snapshot at rangeEnd belongs to the NEXT window, not this one");
});

test("getSeries supports coarser buckets (1 day) for the month period", async () => {
  const repo = createPresenceSnapshotsRepository(pool);
  await insertSnapshotAt("2026-06-01T08:00:00.000Z", 10);
  await insertSnapshotAt("2026-06-01T20:00:00.000Z", 20);
  await insertSnapshotAt("2026-06-02T12:00:00.000Z", 6);

  const series = await repo.getSeries(new Date("2026-06-01T00:00:00.000Z"), new Date("2026-06-03T00:00:00.000Z"), "1 day");

  assert.equal(series.length, 2);
  assert.equal(series[0]!.count, 15, "day 1's two snapshots average to 15");
  assert.equal(series[1]!.count, 6);
});
