import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { createCoursesRepository, CourseHasRoundsError, TeeConfigurationHasRoundsError } from "../src/data/courses.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { applyMigrations } from "./helpers/apply-migrations.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ghs#99: a minimal real round referencing a real tee configuration --
// the only thing delete()/deleteTeeConfiguration()'s conflict path
// actually needs to trigger. A round only needs a real players row
// (players.id), never a linked user account (players.user_id is
// nullable -- ghs#8), so this stays as small as the conflict scenario
// genuinely requires.
async function createReferencingRound(teeConfigurationId: string): Promise<void> {
  const players = createPlayersRepository(pool);
  const rounds = createRoundsRepository(pool);
  const player = await players.create({ firstName: "Round", lastName: "Referencer" });
  await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01" });
}

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

// ghs#99
test("update() applies only the fields provided, real database", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({ name: "Original Name", city: "Original City", country: "ES" });

  const updated = await courses.update(created.id, { name: "New Name" });

  assert.ok(updated);
  assert.equal(updated!.name, "New Name");
  assert.equal(updated!.city, "Original City", "city was not part of this update, must be unchanged");
  assert.equal(updated!.country, "ES", "country was not part of this update, must be unchanged");
});

test("update() can explicitly clear a nullable field to null", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({ name: "Has A City", city: "Original City", country: "ES" });

  const updated = await courses.update(created.id, { city: null });

  assert.ok(updated);
  assert.equal(updated!.city, null);
});

test("update() returns null for a genuinely nonexistent course", async () => {
  const courses = createCoursesRepository(pool);
  const result = await courses.update("00000000-0000-0000-0000-000000000000", { name: "Anything" });
  assert.equal(result, null);
});

test("delete() soft-deletes a course with no referencing rounds, excluding it from list()/get() afterward", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({ name: "Deletable Course" });

  const deleted = await courses.delete(created.id);

  assert.equal(deleted, true);
  assert.equal(await courses.get(created.id), null);
  assert.ok(!(await courses.list()).some((c) => c.id === created.id));
});

test("delete() returns false for an already-deleted or genuinely nonexistent course", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({ name: "Deleted Twice" });
  await courses.delete(created.id);

  assert.equal(await courses.delete(created.id), false, "already soft-deleted");
  assert.equal(await courses.delete("00000000-0000-0000-0000-000000000000"), false, "never existed");
});

// The issue's own central acceptance criterion: a real round referencing
// one of this course's tee configurations must produce a distinguishable
// error, not silently soft-delete a course real round history still
// points to (and never a raw FK-violation message -- delete() is a soft
// UPDATE, not a hard DELETE, so no constraint violation could occur here
// regardless; this is an application-level business rule).
test("delete() throws CourseHasRoundsError when a tee configuration on this course is referenced by an existing round, real Postgres (ghs#99)", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({
    name: "Course With A Real Round",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 71, slopeRating: 120, holes: [] }],
  });
  const teeConfigurationId = created.teeConfigurations[0]!.id;
  await createReferencingRound(teeConfigurationId);

  await assert.rejects(() => courses.delete(created.id), CourseHasRoundsError);

  // Not actually soft-deleted -- the conflict must block the delete
  // outright, not partially apply it.
  assert.ok(await courses.get(created.id));
});

test("createTeeConfiguration() adds a tee configuration to an existing course, real database", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({ name: "Course For New Tee" });

  const tee = await courses.createTeeConfiguration(created.id, {
    name: "Blue",
    holeCount: 18,
    courseRating: 73.5,
    slopeRating: 132,
    holes: [{ holeNumber: 1, distanceYards: 400, par: 4, strokeIndex: 1 }],
  });

  assert.ok(tee);
  assert.equal(tee!.name, "Blue");
  assert.equal(tee!.holes.length, 1);
  const refetched = await courses.get(created.id);
  assert.equal(refetched!.teeConfigurations.length, 1);
  assert.equal(refetched!.teeConfigurations[0]!.id, tee!.id);
});

test("createTeeConfiguration() returns null for a genuinely nonexistent course, real database", async () => {
  const courses = createCoursesRepository(pool);
  const result = await courses.createTeeConfiguration("00000000-0000-0000-0000-000000000000", {
    name: "Red",
    holeCount: 18,
    courseRating: 70,
    slopeRating: 120,
    holes: [],
  });
  assert.equal(result, null);
});

test("updateTeeConfiguration() replaces name/ratings/holes wholesale, real database", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({
    name: "Course For Tee Update",
    teeConfigurations: [
      {
        name: "White",
        holeCount: 18,
        courseRating: 71,
        slopeRating: 120,
        holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
      },
    ],
  });
  const teeId = created.teeConfigurations[0]!.id;

  const updated = await courses.updateTeeConfiguration(teeId, {
    name: "White (Updated)",
    holeCount: 18,
    courseRating: 72.5,
    slopeRating: 125,
    holes: [{ holeNumber: 1, distanceYards: 410, par: 4, strokeIndex: 2 }],
  });

  assert.ok(updated);
  assert.equal(updated!.name, "White (Updated)");
  assert.equal(updated!.slopeRating, 125);
  assert.equal(updated!.holes.length, 1);
  assert.equal(updated!.holes[0]!.strokeIndex, 2, "old hole row replaced, not merged");
});

test("updateTeeConfiguration() returns null for a genuinely nonexistent tee configuration, real database", async () => {
  const courses = createCoursesRepository(pool);
  const result = await courses.updateTeeConfiguration("00000000-0000-0000-0000-000000000000", {
    name: "Anything",
    holeCount: 18,
    courseRating: 70,
    slopeRating: 120,
    holes: [],
  });
  assert.equal(result, null);
});

test("deleteTeeConfiguration() soft-deletes an unreferenced tee configuration, real database", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({
    name: "Course For Tee Delete",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 71, slopeRating: 120, holes: [] }],
  });
  const teeId = created.teeConfigurations[0]!.id;

  assert.equal(await courses.deleteTeeConfiguration(teeId), true);
  assert.equal(await courses.deleteTeeConfiguration(teeId), false, "already deleted");
  assert.equal(await courses.deleteTeeConfiguration("00000000-0000-0000-0000-000000000000"), false, "never existed");
});

test("deleteTeeConfiguration() throws TeeConfigurationHasRoundsError when referenced by an existing round, real Postgres (ghs#99)", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({
    name: "Course For Referenced Tee",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 71, slopeRating: 120, holes: [] }],
  });
  const teeId = created.teeConfigurations[0]!.id;
  await createReferencingRound(teeId);

  await assert.rejects(() => courses.deleteTeeConfiguration(teeId), TeeConfigurationHasRoundsError);

  // Not actually soft-deleted -- getTeeConfiguration (used by scoring/
  // round-entry for an *existing* round) must keep resolving it.
  assert.ok(await courses.getTeeConfiguration(teeId));
});

// The critical soft-delete filtering distinction this issue's design
// depends on: get()'s nested list must stop offering a deleted tee
// configuration for a *new* round (NewRoundPage's own tee-selection
// dropdown sources from here, apps/web/src/pages/NewRoundPage.tsx), but
// getTeeConfiguration() -- what an *already-created* round's scoring/
// hole-entry resolves through (ghs#92) -- must keep resolving it
// regardless. Two different callers, two deliberately different
// filtering rules over the same soft-delete flag.
test("a soft-deleted tee configuration disappears from get()'s nested list but getTeeConfiguration() still resolves it, real database (ghs#99)", async () => {
  const courses = createCoursesRepository(pool);
  const created = await courses.create({
    name: "Course With Two Tees",
    teeConfigurations: [
      { name: "White", holeCount: 18, courseRating: 71, slopeRating: 120, holes: [] },
      { name: "Blue", holeCount: 18, courseRating: 73, slopeRating: 128, holes: [] },
    ],
  });
  const whiteId = created.teeConfigurations.find((t) => t.name === "White")!.id;

  await courses.deleteTeeConfiguration(whiteId);

  const refetched = await courses.get(created.id);
  assert.equal(refetched!.teeConfigurations.length, 1, "the deleted tee configuration must not appear in the course's nested list");
  assert.equal(refetched!.teeConfigurations[0]!.name, "Blue");

  const stillResolvable = await courses.getTeeConfiguration(whiteId);
  assert.ok(stillResolvable, "an existing round's own lookup must not break just because the tee configuration was since deleted");
  assert.equal(stillResolvable!.name, "White");
});
