import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { applyMigrations } from "./helpers/apply-migrations.ts";

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

test("create then get round-trips a course with tee configurations and holes through a real database", async () => {
  const courses = createCoursesRepository(pool);

  const created = await courses.create({
    name: "Club de Golf Terramar",
    country: "ES",
    teeConfigurations: [
      {
        name: "White",
        holeCount: 18,
        courseRating: 71.2,
        slopeRating: 128,
        holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
      },
    ],
  });

  const fetched = await courses.get(created.id);

  assert.ok(fetched);
  assert.equal(fetched!.teeConfigurations.length, 1);
  assert.equal(fetched!.teeConfigurations[0]!.slopeRating, 128);
  assert.equal(fetched!.teeConfigurations[0]!.holes.length, 1);
  assert.equal(fetched!.teeConfigurations[0]!.holes[0]!.strokeIndex, 7);
});

// ghs#92: getTeeConfiguration is used internally (rounds.service.ts,
// scoring.service.ts) since ghs#20/#58, but had no direct test of its
// own until it was exposed over HTTP (GET /tee-configurations/:id) --
// closing that real gap here, not just testing the new route.
test("getTeeConfiguration returns the real tee configuration with its holes, ordered by hole number, real database (ghs#92)", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({
    name: "Tee Configuration Lookup Test Course",
    country: "ES",
    teeConfigurations: [
      {
        name: "Blue",
        holeCount: 18,
        courseRating: 74.1,
        slopeRating: 135,
        holes: [
          { holeNumber: 2, distanceYards: 410, par: 4, strokeIndex: 3 },
          { holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 },
        ],
      },
    ],
  });
  const teeConfigurationId = created.teeConfigurations[0]!.id;

  const fetched = await courses.getTeeConfiguration(teeConfigurationId);

  assert.ok(fetched);
  assert.equal(fetched!.id, teeConfigurationId);
  assert.equal(fetched!.slopeRating, 135);
  assert.deepEqual(fetched!.holes.map((h) => h.holeNumber), [1, 2], "ordered by hole number, not insertion order");
});

test("getTeeConfiguration returns null for a genuinely nonexistent id, real database (ghs#92)", async () => {
  const courses = createCoursesRepository(pool);
  const result = await courses.getTeeConfiguration("00000000-0000-0000-0000-000000000000");
  assert.equal(result, null);
});

// The evidenced reason clubs is its own entity, not a legacy carry-forward
// (ghs#7): a single real club can own more than one named course. Proves
// the new schema actually supports the La Manga Club scenario the CSV
// export evidence surfaced, not just that the clubs/courses tables exist.
test("a single club can own more than one course (La Manga Club scenario)", async () => {
  const clubs = createClubsRepository(pool);
  const courses = createCoursesRepository(pool);

  const club = await clubs.create({ name: "La Manga Club", city: "Murcia", country: "ES" });

  const north = await courses.create({ clubId: club.id, name: "La Manga Club — North", country: "ES" });
  const south = await courses.create({ clubId: club.id, name: "La Manga Club — South", country: "ES" });

  const all = await courses.list();
  const forClub = all.filter((c) => c.clubId === club.id);

  assert.equal(forClub.length, 2);
  assert.ok(forClub.some((c) => c.id === north.id));
  assert.ok(forClub.some((c) => c.id === south.id));
});

test("a course may exist without a club (club_id nullable, per ghs#7's resolved open question)", async () => {
  const courses = createCoursesRepository(pool);

  const created = await courses.create({ name: "Public Course With No Club" });

  assert.equal(created.clubId, null);
});
