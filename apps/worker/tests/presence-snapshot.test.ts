import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyMigrations } from "@ghs/api/data/migrations/apply";
import { createUsersRepository } from "@ghs/api/data/users.repository";
import { createPresenceSnapshotsRepository } from "@ghs/api/data/presence-snapshots.repository";
import { runPresenceSnapshot } from "../src/application/presence-snapshot.service.ts";

// ghs#195: real-Postgres coverage of the worker's new periodic task --
// proves it records the SAME number countActiveNow() itself would report
// at that instant, not a separately-computed approximation.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE users, presence_snapshots RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

test("runPresenceSnapshot records the real, current countActiveNow() value", async () => {
  const users = createUsersRepository(pool);
  const presenceSnapshots = createPresenceSnapshotsRepository(pool);

  const active = await users.create({ email: "presence-active@example.com", passwordHash: "irrelevant", role: "player", status: "active" });
  const stale = await users.create({ email: "presence-stale@example.com", passwordHash: "irrelevant", role: "player", status: "active" });
  await pool.query("UPDATE users SET last_active_at = now() WHERE id = $1", [active.id]);
  await pool.query("UPDATE users SET last_active_at = now() - INTERVAL '10 minutes' WHERE id = $1", [stale.id]);

  await runPresenceSnapshot({ users, presenceSnapshots });

  const rows = await pool.query<{ active_count: number }>("SELECT active_count FROM presence_snapshots");
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0]!.active_count, 1, "only the user active within the last 5 minutes counts");
});

test("runPresenceSnapshot records a real zero row when no one is active, rather than skipping the write", async () => {
  const users = createUsersRepository(pool);
  const presenceSnapshots = createPresenceSnapshotsRepository(pool);

  await runPresenceSnapshot({ users, presenceSnapshots });

  const rows = await pool.query<{ active_count: number }>("SELECT active_count FROM presence_snapshots");
  assert.equal(rows.rows.length, 1, "a genuine zero is still a real data point, not silently omitted");
  assert.equal(rows.rows[0]!.active_count, 0);
});

test("two runs record two independent rows -- history accumulates, it doesn't overwrite in place (unlike users.last_active_at itself)", async () => {
  const users = createUsersRepository(pool);
  const presenceSnapshots = createPresenceSnapshotsRepository(pool);

  await runPresenceSnapshot({ users, presenceSnapshots });
  await runPresenceSnapshot({ users, presenceSnapshots });

  const rows = await pool.query("SELECT id FROM presence_snapshots");
  assert.equal(rows.rows.length, 2);
});
