import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { applyMigrations } from "./helpers/apply-migrations.ts";

// Runs against a real Postgres instance (ENG-030.4) -- no mock fallback.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE clubs RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

test("create then list round-trips through a real database", async () => {
  const repository = createClubsRepository(pool);

  const created = await repository.create({ name: "La Manga Club", city: "Murcia", country: "ES" });
  const clubs = await repository.list();

  assert.equal(created.name, "La Manga Club");
  assert.equal(clubs.length, 1);
  assert.equal(clubs[0]!.id, created.id);
});

test("get returns null for an unknown id", async () => {
  const repository = createClubsRepository(pool);

  assert.equal(await repository.get("00000000-0000-0000-0000-000000000000"), null);
});
