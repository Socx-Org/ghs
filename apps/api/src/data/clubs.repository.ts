import type { Pool } from "pg";

// A real, evidenced domain entity (ghs#7) -- a club may own one or more
// courses. Not carried forward from legacy GHS (which had no clubs table);
// introduced because the CSV export evidence showed a single real club
// (La Manga) with two separately named courses, which legacy's
// course-doubles-as-club schema could not represent.

export interface Club {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  createdAt: string;
}

export interface ClubsRepository {
  list(): Promise<Club[]>;
  create(input: { name: string; city?: string; country?: string }): Promise<Club>;
  get(id: string): Promise<Club | null>;
}

interface ClubRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  created_at: Date;
}

function toClub(row: ClubRow): Club {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    country: row.country,
    createdAt: row.created_at.toISOString(),
  };
}

// The only place this table is queried -- nothing outside data/ imports
// `pg` directly (ADR-060).
export function createClubsRepository(pool: Pool): ClubsRepository {
  return {
    async list() {
      const result = await pool.query<ClubRow>(
        "SELECT id, name, city, country, created_at FROM clubs WHERE deleted_at IS NULL ORDER BY name",
      );
      return result.rows.map(toClub);
    },

    async create(input) {
      const result = await pool.query<ClubRow>(
        `INSERT INTO clubs (name, city, country)
         VALUES ($1, $2, $3)
         RETURNING id, name, city, country, created_at`,
        [input.name, input.city ?? null, input.country ?? null],
      );
      return toClub(result.rows[0]!);
    },

    async get(id) {
      const result = await pool.query<ClubRow>(
        "SELECT id, name, city, country, created_at FROM clubs WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      return result.rows[0] ? toClub(result.rows[0]) : null;
    },
  };
}
