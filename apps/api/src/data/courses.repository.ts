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

export interface CoursesRepository {
  list(): Promise<CourseSummary[]>;
  create(input: CreateCourseInput): Promise<Course>;
  get(id: string): Promise<Course | null>;
  // Rounds only know their tee_configuration_id, not the owning course --
  // scoring (net double bogey, differential) needs hole metadata and
  // ratings by tee-configuration directly, not nested under a course
  // lookup.
  getTeeConfiguration(id: string): Promise<TeeConfiguration | null>;
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

      const teeResult = await pool.query<TeeConfigRow>(
        `SELECT id, course_id, name, hole_count, course_rating, slope_rating
         FROM tee_configurations WHERE course_id = $1 ORDER BY name`,
        [id],
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

      return { ...toSummary(courseRow), teeConfigurations };
    },

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
  };
}
