import type { Pool } from "pg";

export type UserStatus = "pending_verification" | "active" | "disabled" | "deleted";
export type UserRole = "player" | "admin" | "super_admin";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  role: UserRole;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface ListUsersFilter {
  role?: UserRole;
  status?: UserStatus;
  limit: number;
  offset: number;
}

export interface ListUsersPage {
  users: User[];
  total: number;
}

// ghs#180: the Admin Dashboard's Total Users widget -- total plus a
// role breakdown, matching design doc section C's "not a donut" call
// (a KPI headline + compact inline breakdown instead). No status
// filter, same default GET /admin/users itself already uses (ghs#98) --
// "how many accounts does the system have" counts every status, not
// just active ones.
export interface UserRoleBreakdown {
  total: number;
  player: number;
  admin: number;
  superAdmin: number;
}

// ghs#180: the Admin Dashboard's User Trends widget -- one row per day
// in the requested window, oldest first, zero-filled for any day with
// no registrations (a bar chart with silently-skipped zero days would
// misread as missing data, not "genuinely zero that day").
export interface RegistrationTrendPoint {
  date: string;
  count: number;
}

export interface UsersRepository {
  create(input: { email: string; passwordHash: string; role: UserRole; status: UserStatus }): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  markEmailVerified(id: string): Promise<void>;
  setStatus(id: string, status: UserStatus): Promise<void>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
  // ghs#98: no default status filter (unlike players'/courses' deleted_at
  // IS NULL convention) -- status here is a first-class enum value, not a
  // separate soft-delete gate, and an admin listing accounts needs
  // disabled/deleted visibility by default, not just active ones.
  list(filter: ListUsersFilter): Promise<ListUsersPage>;
  // ghs#177: the heartbeat endpoint's own real work -- a bare timestamp
  // write, no return value (the caller has nothing to do with the new
  // value). Never surfaced on the User type/any DTO -- see
  // countActiveNow's own doc comment for why per-user presence stays
  // internal to this repository.
  updateLastActiveAt(id: string): Promise<void>;
  // ghs#177: the Admin Dashboard's "Active Right Now" widget (#180) --
  // an aggregate count only. Deliberately no per-user presence query
  // exists anywhere in this repository: the design review explicitly
  // rejected showing *who* is active as a materially different (and
  // more sensitive) feature from a bare count, so there's nothing here
  // for a future caller to accidentally misuse into that shape.
  countActiveNow(): Promise<number>;
  // ghs#180: the Admin Dashboard's Total Users widget.
  getRoleBreakdown(): Promise<UserRoleBreakdown>;
  // ghs#180: the Admin Dashboard's User Trends widget -- days is the
  // real window size (7/30/90, validated at the HTTP boundary in
  // dashboard.ts, not re-validated here), always returning exactly that
  // many rows, oldest first, ending today.
  getRegistrationTrend(days: number): Promise<RegistrationTrendPoint[]>;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  status: UserStatus;
  role: UserRole;
  email_verified_at: Date | null;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    status: row.status,
    role: row.role,
    emailVerifiedAt: row.email_verified_at ? row.email_verified_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = "id, email::text AS email, password_hash, status, role, email_verified_at, created_at";

export function createUsersRepository(pool: Pool): UsersRepository {
  return {
    async create(input) {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (email, password_hash, role, status)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SELECT_COLUMNS}`,
        [input.email, input.passwordHash, input.role, input.status],
      );
      return toUser(result.rows[0]!);
    },

    async findByEmail(email) {
      const result = await pool.query<UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users WHERE email = $1`,
        [email],
      );
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },

    async findById(id) {
      const result = await pool.query<UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },

    async markEmailVerified(id) {
      await pool.query(
        "UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1",
        [id],
      );
    },

    async setStatus(id, status) {
      await pool.query(
        "UPDATE users SET status = $2, updated_at = now() WHERE id = $1",
        [id, status],
      );
    },

    async setPasswordHash(id, passwordHash) {
      await pool.query(
        "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1",
        [id, passwordHash],
      );
    },

    async list(filter) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.role) {
        params.push(filter.role);
        conditions.push(`role = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM users ${where}`, params);
      const total = Number(countResult.rows[0]!.count);

      const listParams = [...params, filter.limit, filter.offset];
      const result = await pool.query<UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users ${where}
         ORDER BY created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );
      return { users: result.rows.map(toUser), total };
    },

    async updateLastActiveAt(id) {
      await pool.query("UPDATE users SET last_active_at = now() WHERE id = $1", [id]);
    },

    async countActiveNow() {
      // 5-minute window -- the design review's own fixed definition of
      // "active right now" (design doc section C/J.2), not a
      // caller-configurable parameter. A literal SQL interval, same
      // convention as handicap-history.repository.ts's own hardcoded
      // INTERVAL '365 days' for the Low Handicap Index window.
      const result = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM users WHERE last_active_at > now() - INTERVAL '5 minutes'",
      );
      return Number(result.rows[0]!.count);
    },

    async getRoleBreakdown() {
      const result = await pool.query<{ total: number; player: number; admin: number; super_admin: number }>(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE role = 'player')::int AS player,
           count(*) FILTER (WHERE role = 'admin')::int AS admin,
           count(*) FILTER (WHERE role = 'super_admin')::int AS super_admin
         FROM users`,
      );
      const row = result.rows[0]!;
      return { total: row.total, player: row.player, admin: row.admin, superAdmin: row.super_admin };
    },

    async getRegistrationTrend(days) {
      // generate_series + LEFT JOIN, not a bare GROUP BY -- a plain
      // aggregation would silently omit any day with zero registrations,
      // which a bar chart (design doc section C: recharts' BarChart, the
      // first real use of it in this app) would misread as a gap in the
      // data rather than a genuine zero.
      //
      // Review finding, PR #186: gs.day::date::text, not gs.day::date --
      // node-postgres does parse a plain DATE column into a real JS
      // Date (confirmed directly; the reviewer's own claim that it
      // returns a string, and that .toISOString() therefore throws, is
      // not what actually happens), but it does so using the *local*
      // timezone, not UTC. now()::date in a UTC+2 session, for example,
      // comes back as a Date whose own .toISOString() reads
      // "...T22:00:00.000Z" -- the *previous* UTC calendar day -- so
      // .slice(0, 10) reported a real registration under yesterday's
      // date, one full day off from the truth. Confirmed directly
      // against this repo's own real Postgres before writing this fix,
      // not assumed from the review comment. Casting to ::text in SQL
      // sidesteps the whole JS-Date/timezone question -- this
      // codebase's own established fix for exactly this class of bug,
      // same technique as pcc.repository.ts's `played_on::text AS
      // played_on` (that file's own comment: "keeps played_on a plain,
      // unambiguous 'YYYY-MM-DD' string end to end").
      const result = await pool.query<{ date: string; count: number }>(
        `SELECT gs.day::date::text AS date, coalesce(u.count, 0)::int AS count
         FROM generate_series(
           date_trunc('day', now()) - ($1::int - 1 || ' days')::interval,
           date_trunc('day', now()),
           interval '1 day'
         ) AS gs(day)
         LEFT JOIN (
           SELECT date_trunc('day', created_at) AS day, count(*) AS count
           FROM users
           WHERE created_at >= date_trunc('day', now()) - ($1::int - 1 || ' days')::interval
           GROUP BY date_trunc('day', created_at)
         ) u ON u.day = gs.day
         ORDER BY gs.day ASC`,
        [days],
      );
      return result.rows.map((row) => ({ date: row.date, count: row.count }));
    },
  };
}
