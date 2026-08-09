import type { Pool } from "pg";

// Stand-in resource proving the three-layer pattern end-to-end (config ->
// data -> application -> interface). Deliberately not GHS's real domain --
// Phase 1 (Domain Data Model) replaces this with clubs/courses/players/
// rounds once that phase's own discovery-grounded schema is ready. Adopted
// verbatim from reference/application (Approved, on-host verified) rather
// than improvised, per this phase's own scope: prove the scaffold works,
// not build the domain.

export interface Widget {
  id: number;
  name: string;
  createdAt: string;
}

// Narrow interface exposed upward -- the application layer depends on this
// shape, never on `pg` or SQL directly (ADR-060).
export interface WidgetsRepository {
  list(): Promise<Widget[]>;
  create(name: string): Promise<Widget>;
}

function toWidget(row: { id: number; name: string; created_at: Date }): Widget {
  return { id: row.id, name: row.name, createdAt: row.created_at.toISOString() };
}

export function createWidgetsRepository(pool: Pool): WidgetsRepository {
  return {
    async list() {
      const result = await pool.query<{ id: number; name: string; created_at: Date }>(
        "SELECT id, name, created_at FROM widgets ORDER BY id",
      );
      return result.rows.map(toWidget);
    },

    async create(name: string) {
      const result = await pool.query<{ id: number; name: string; created_at: Date }>(
        "INSERT INTO widgets (name) VALUES ($1) RETURNING id, name, created_at",
        [name],
      );
      return toWidget(result.rows[0]!);
    },
  };
}
