import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { createWidgetsRepository } from "../src/data/widgets.repository.ts";

// Runs against a real Postgres instance (ENG-030.4: integration tests MUST
// run against a real or containerized dependency, not a mock -- CI's
// ci.yml provisions a postgres service container for exactly this).
// Requires DATABASE_URL to point at a real, reachable Postgres; there is
// no mock fallback.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

before(async () => {
  const schema = readFileSync(new URL("../src/data/schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
});

beforeEach(async () => {
  await pool.query("TRUNCATE widgets RESTART IDENTITY");
});

after(async () => {
  await pool.end();
});

test("create then list round-trips through a real database", async () => {
  const repository = createWidgetsRepository(pool);

  const created = await repository.create("integration widget");
  const widgets = await repository.list();

  assert.equal(created.name, "integration widget");
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0]!.id, created.id);
});
