import type { Pool } from "pg";

// Real WHS course-rating structure, preserved from legacy GHS on its
// domain merits: a course has one or more tee configurations (colour),
// each with its own course/slope rating and up to 18 holes. course_id is
// nullable-from-the-club-side in the sense that clubs.club_id itself is
// nullable (ghs#7) -- courses always belong to at most one club.

export interface Hole {
  id: string;
  holeNumber: number;
  distanceYards: number;
  par: number;
  strokeIndex: number;
}

export interface TeeConfiguration {
  id: string;
  name: string;
  holeCount: number;
  courseRating: number;
  slopeRating: number;
  holes: Hole[];
}

export interface Course {
  id: string;
  clubId: string | null;
  name: string;
  city: string | null;
  country: string | null;
  teeConfigurations: TeeConfiguration[];
}

export interface CourseSummary {
  id: string;
  clubId: string | null;
  name: string;
  city: string | null;
  country: string | null;
}

export interface CreateHoleInput {
  holeNumber: number;
  distanceYards: number;
  par: number;
  strokeIndex: number;
}

export interface CreateTeeConfigurationInput {
  name: string;
  holeCount: number;
  courseRating: number;
  slopeRating: number;
  holes: CreateHoleInput[];
}

export interface CreateCourseInput {
  clubId?: string;
  name: string;
  city?: string;
  country?: string;
  teeConfigurations?: CreateTeeConfigurationInput[];
}

// ghs#99. Partial by design (PATCH semantics) -- a field's key must be
// present at all (even as null) to be touched; omitting it entirely
// leaves that column unchanged. Distinguished from CreateCourseInput
// (which always creates a definite row) since "leave this alone" is a
// real, meaningful choice here that create() never has to represent.
export interface UpdateCourseInput {
  clubId?: string | null;
  name?: string;
  city?: string | null;
  country?: string | null;
}

// ghs#99. Unlike UpdateCourseInput, this is a full replacement (same
// shape/validation as CreateTeeConfigurationInput, per the issue's own
// scope) -- holes are deleted and reinserted wholesale, not merged
// field-by-field. Safe against existing rounds: hole_scores keys off
// (round_id, hole_number), never holes.id (004_rounds_and_scoring.sql),
// so replacing a tee configuration's hole rows never orphans historical
// scoring data.
export type UpdateTeeConfigurationInput = CreateTeeConfigurationInput;

// ghs#99: thrown, not returned, since this is a genuine business-rule
// conflict rather than an ordinary "not found" -- mirrors the existing
// RoundNotFoundError/InvalidRoundTransitionError convention
// (rounds.service.ts) rather than inventing a new error-signalling
// shape. .message IS the stable, frontend-matchable error code itself
// (same convention as auth.service.ts's token-classification errors),
// not a human sentence -- the route passes it straight through as the
// response body's `error` field.
export class CourseHasRoundsError extends Error {}
export class TeeConfigurationHasRoundsError extends Error {}

export interface CoursesRepository {
  list(): Promise<CourseSummary[]>;
  create(input: CreateCourseInput): Promise<Course>;
  get(id: string): Promise<Course | null>;
  // Rounds only know their tee_configuration_id, not the owning course --
  // scoring (net double bogey, differential) needs hole metadata and
  // ratings by tee-configuration directly, not nested under a course
  // lookup.
  getTeeConfiguration(id: string): Promise<TeeConfiguration | null>;
  // null: course doesn't exist (or is already soft-deleted) -- 404, not
  // an error, same convention as get().
  update(id: string, input: UpdateCourseInput): Promise<Course | null>;
  // false: course doesn't exist (or is already soft-deleted) -- 404.
  // Throws CourseHasRoundsError instead of soft-deleting when any of
  // this course's tee configurations is referenced by an existing round
  // -- exactly the case the issue calls out (a raw FK violation would
  // never actually fire here, since this is an UPDATE not a DELETE, but
  // silently soft-deleting a course real round history still points to
  // would be a confusing, undiscoverable state for the frontend to land
  // a player or admin in).
  delete(id: string): Promise<boolean>;
  // null: the owning course doesn't exist (or is already soft-deleted).
  createTeeConfiguration(courseId: string, input: CreateTeeConfigurationInput): Promise<TeeConfiguration | null>;
  // null: tee configuration doesn't exist (or is already soft-deleted).
  updateTeeConfiguration(id: string, input: UpdateTeeConfigurationInput): Promise<TeeConfiguration | null>;
  // false: tee configuration doesn't exist (or is already soft-deleted).
  // Throws TeeConfigurationHasRoundsError -- same reasoning as delete()
  // above.
  deleteTeeConfiguration(id: string): Promise<boolean>;
}

interface CourseRow {
  id: string;
  club_id: string | null;
  name: string;
  city: string | null;
  country: string | null;
}

interface TeeConfigRow {
  id: string;
  course_id: string;
  name: string;
  hole_count: number;
  course_rating: string;
  slope_rating: number;
}

interface HoleRow {
  id: string;
  tee_configuration_id: string;
  hole_number: number;
  distance_yards: number;
  par: number;
  stroke_index: number;
}

function toSummary(row: CourseRow): CourseSummary {
  return { id: row.id, clubId: row.club_id, name: row.name, city: row.city, country: row.country };
}

function toHole(row: HoleRow): Hole {
  return {
    id: row.id,
    holeNumber: row.hole_number,
    distanceYards: row.distance_yards,
    par: row.par,
    strokeIndex: row.stroke_index,
  };
}

function toTeeConfiguration(row: TeeConfigRow, holes: Hole[]): TeeConfiguration {
  return {
    id: row.id,
    name: row.name,
    holeCount: row.hole_count,
    courseRating: Number(row.course_rating),
    slopeRating: row.slope_rating,
    holes,
  };
}

// Shared by get() and update() -- both need "this course's real, live
// tee configurations, with their holes" and must agree on excluding a
// since-deleted one (a soft-deleted tee configuration must disappear
// from a course's own detail view exactly like a soft-deleted course
// disappears from list(), not just from a top-level list somewhere).
async function fetchTeeConfigurationsForCourse(pool: Pool, courseId: string): Promise<TeeConfiguration[]> {
  const teeResult = await pool.query<TeeConfigRow>(
    `SELECT id, course_id, name, hole_count, course_rating, slope_rating
     FROM tee_configurations WHERE course_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [courseId],
  );

  const teeConfigurations: TeeConfiguration[] = [];
  for (const teeRow of teeResult.rows) {
    const holeResult = await pool.query<HoleRow>(
      `SELECT id, tee_configuration_id, hole_number, distance_yards, par, stroke_index
       FROM holes WHERE tee_configuration_id = $1 ORDER BY hole_number`,
      [teeRow.id],
    );
    teeConfigurations.push(toTeeConfiguration(teeRow, holeResult.rows.map(toHole)));
  }
  return teeConfigurations;
}

// Shared by delete() and deleteTeeConfiguration() -- both block a soft-
// delete, rather than let a raw FK violation surface, exactly when an
// existing round already references one of the tee configurations in
// question (rounds.tee_configuration_id ON DELETE RESTRICT, migration
// 004). A course conflicts if ANY of its tee configurations does.
async function hasReferencingRounds(pool: Pool, teeConfigurationIds: string[]): Promise<boolean> {
  if (teeConfigurationIds.length === 0) return false;
  const result = await pool.query(
    "SELECT 1 FROM rounds WHERE tee_configuration_id = ANY($1::uuid[]) LIMIT 1",
    [teeConfigurationIds],
  );
  return result.rows.length > 0;
}

export function createCoursesRepository(pool: Pool): CoursesRepository {
  return {
    async list() {
      const result = await pool.query<CourseRow>(
        "SELECT id, club_id, name, city, country FROM courses WHERE deleted_at IS NULL ORDER BY name",
      );
      return result.rows.map(toSummary);
    },

    async create(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const courseResult = await client.query<CourseRow>(
          `INSERT INTO courses (club_id, name, city, country)
           VALUES ($1, $2, $3, $4)
           RETURNING id, club_id, name, city, country`,
          [input.clubId ?? null, input.name, input.city ?? null, input.country ?? null],
        );
        const course = courseResult.rows[0]!;

        const teeConfigurations: TeeConfiguration[] = [];
        for (const teeInput of input.teeConfigurations ?? []) {
          const teeResult = await client.query<TeeConfigRow>(
            `INSERT INTO tee_configurations (course_id, name, hole_count, course_rating, slope_rating)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, course_id, name, hole_count, course_rating, slope_rating`,
            [course.id, teeInput.name, teeInput.holeCount, teeInput.courseRating, teeInput.slopeRating],
          );
          const teeRow = teeResult.rows[0]!;

          const holes: Hole[] = [];
          for (const holeInput of teeInput.holes) {
            const holeResult = await client.query<HoleRow>(
              `INSERT INTO holes (tee_configuration_id, hole_number, distance_yards, par, stroke_index)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, tee_configuration_id, hole_number, distance_yards, par, stroke_index`,
              [teeRow.id, holeInput.holeNumber, holeInput.distanceYards, holeInput.par, holeInput.strokeIndex],
            );
            holes.push(toHole(holeResult.rows[0]!));
          }

          teeConfigurations.push(toTeeConfiguration(teeRow, holes));
        }

        await client.query("COMMIT");

        return { ...toSummary(course), teeConfigurations };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async get(id) {
      const courseResult = await pool.query<CourseRow>(
        "SELECT id, club_id, name, city, country FROM courses WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      const courseRow = courseResult.rows[0];
      if (!courseRow) return null;

      const teeConfigurations = await fetchTeeConfigurationsForCourse(pool, id);
      return { ...toSummary(courseRow), teeConfigurations };
    },

    // Deliberately NOT filtered by tee_configurations.deleted_at --
    // unlike get()'s nested list (which must stop offering a deleted
    // tee configuration for a *new* round), this is the lookup an
    // *existing* round's scoring/hole-entry already depends on
    // (ghs#92's own doc comment above), and must keep resolving
    // regardless of whether the tee configuration was since deleted.
    async getTeeConfiguration(id) {
      const teeResult = await pool.query<TeeConfigRow>(
        `SELECT id, course_id, name, hole_count, course_rating, slope_rating
         FROM tee_configurations WHERE id = $1`,
        [id],
      );
      const teeRow = teeResult.rows[0];
      if (!teeRow) return null;

      const holeResult = await pool.query<HoleRow>(
        `SELECT id, tee_configuration_id, hole_number, distance_yards, par, stroke_index
         FROM holes WHERE tee_configuration_id = $1 ORDER BY hole_number`,
        [teeRow.id],
      );

      return toTeeConfiguration(teeRow, holeResult.rows.map(toHole));
    },

    async update(id, input) {
      const setClauses: string[] = [];
      const values: unknown[] = [id];
      if (input.name !== undefined) {
        values.push(input.name);
        setClauses.push(`name = $${values.length}`);
      }
      if (input.clubId !== undefined) {
        values.push(input.clubId);
        setClauses.push(`club_id = $${values.length}`);
      }
      if (input.city !== undefined) {
        values.push(input.city);
        setClauses.push(`city = $${values.length}`);
      }
      if (input.country !== undefined) {
        values.push(input.country);
        setClauses.push(`country = $${values.length}`);
      }

      const courseResult = setClauses.length === 0
        ? await pool.query<CourseRow>("SELECT id, club_id, name, city, country FROM courses WHERE id = $1 AND deleted_at IS NULL", [id])
        : await pool.query<CourseRow>(
            `UPDATE courses SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL
             RETURNING id, club_id, name, city, country`,
            values,
          );
      const courseRow = courseResult.rows[0];
      if (!courseRow) return null;

      const teeConfigurations = await fetchTeeConfigurationsForCourse(pool, id);
      return { ...toSummary(courseRow), teeConfigurations };
    },

    async delete(id) {
      // Existence/not-already-deleted checked FIRST -- otherwise an
      // already soft-deleted course whose (still physically present,
      // soft-delete doesn't remove them) tee configurations happen to
      // carry an old round reference would throw CourseHasRoundsError
      // (409) a second time instead of the documented false/404 for an
      // already-gone course (review finding, PR #131).
      const courseResult = await pool.query("SELECT id FROM courses WHERE id = $1 AND deleted_at IS NULL", [id]);
      if (courseResult.rows.length === 0) return false;

      const teeIdsResult = await pool.query<{ id: string }>(
        "SELECT id FROM tee_configurations WHERE course_id = $1",
        [id],
      );
      if (await hasReferencingRounds(pool, teeIdsResult.rows.map((r) => r.id))) {
        throw new CourseHasRoundsError("course_has_rounds");
      }

      const result = await pool.query(
        "UPDATE courses SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
      );
      return result.rows.length > 0;
    },

    async createTeeConfiguration(courseId, input) {
      const courseResult = await pool.query("SELECT id FROM courses WHERE id = $1 AND deleted_at IS NULL", [courseId]);
      if (courseResult.rows.length === 0) return null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const teeResult = await client.query<TeeConfigRow>(
          `INSERT INTO tee_configurations (course_id, name, hole_count, course_rating, slope_rating)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, course_id, name, hole_count, course_rating, slope_rating`,
          [courseId, input.name, input.holeCount, input.courseRating, input.slopeRating],
        );
        const teeRow = teeResult.rows[0]!;

        const holes: Hole[] = [];
        for (const holeInput of input.holes) {
          const holeResult = await client.query<HoleRow>(
            `INSERT INTO holes (tee_configuration_id, hole_number, distance_yards, par, stroke_index)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, tee_configuration_id, hole_number, distance_yards, par, stroke_index`,
            [teeRow.id, holeInput.holeNumber, holeInput.distanceYards, holeInput.par, holeInput.strokeIndex],
          );
          holes.push(toHole(holeResult.rows[0]!));
        }

        await client.query("COMMIT");
        return toTeeConfiguration(teeRow, holes);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    // Full replacement, not a field-by-field merge (same validation
    // shape as createTeeConfiguration/create()'s nested case, per the
    // issue's own scope) -- holes are deleted and reinserted wholesale.
    // Safe against existing rounds: see UpdateTeeConfigurationInput's
    // own doc comment above.
    async updateTeeConfiguration(id, input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const teeResult = await client.query<TeeConfigRow>(
          `UPDATE tee_configurations SET name = $2, hole_count = $3, course_rating = $4, slope_rating = $5
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id, course_id, name, hole_count, course_rating, slope_rating`,
          [id, input.name, input.holeCount, input.courseRating, input.slopeRating],
        );
        const teeRow = teeResult.rows[0];
        if (!teeRow) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query("DELETE FROM holes WHERE tee_configuration_id = $1", [id]);

        const holes: Hole[] = [];
        for (const holeInput of input.holes) {
          const holeResult = await client.query<HoleRow>(
            `INSERT INTO holes (tee_configuration_id, hole_number, distance_yards, par, stroke_index)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, tee_configuration_id, hole_number, distance_yards, par, stroke_index`,
            [id, holeInput.holeNumber, holeInput.distanceYards, holeInput.par, holeInput.strokeIndex],
          );
          holes.push(toHole(holeResult.rows[0]!));
        }

        await client.query("COMMIT");
        return toTeeConfiguration(teeRow, holes);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async deleteTeeConfiguration(id) {
      // Same ordering fix as delete() above, same reasoning (review
      // finding, PR #131): existence/not-already-deleted first, so an
      // already soft-deleted tee configuration a round happens to still
      // reference reports false/404, never a 409 conflict.
      const existsResult = await pool.query("SELECT id FROM tee_configurations WHERE id = $1 AND deleted_at IS NULL", [id]);
      if (existsResult.rows.length === 0) return false;

      if (await hasReferencingRounds(pool, [id])) {
        throw new TeeConfigurationHasRoundsError("tee_configuration_has_rounds");
      }

      const result = await pool.query(
        "UPDATE tee_configurations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [id],
      );
      return result.rows.length > 0;
    },
  };
}
