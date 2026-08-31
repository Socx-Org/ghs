import type { Pool, PoolClient } from "pg";

export interface Player {
  id: string;
  userId: string | null;
  clubId: string | null;
  firstName: string;
  lastName: string;
  country: string;
  createdAt: string;
  // ghs#60: added to the projection -- the columns themselves have
  // existed since migration 007 (handicap history/cached index), but
  // were never read anywhere outside the internal recalculation
  // pipeline (HandicapHistoryRepository.getCurrentIndex). Null until a
  // player's first real WHS calculation (or admin override) sets them.
  handicapIndex: number | null;
  lowHandicapIndex: number | null;
}

export interface CreatePlayerInput {
  userId?: string;
  clubId?: string;
  firstName: string;
  lastName: string;
  country?: string;
}

export interface PlayersRepository {
  create(input: CreatePlayerInput, client?: PoolClient): Promise<Player>;
  findByUserId(userId: string): Promise<Player | null>;
  // ghs#98: bulk variant of findByUserId, for composing a name onto each
  // row of a paginated user list without an N+1 query per row.
  findByUserIds(userIds: string[]): Promise<Player[]>;
  get(id: string): Promise<Player | null>;
  // ghs#191: admin account-edit's own name-correction field. Takes the
  // player's own id, not a userId -- same shape as get() above, and the
  // caller (admin-users.service.ts) already has the player row in hand
  // by the time it needs this.
  updateName(id: string, firstName: string, lastName: string): Promise<void>;
}

interface PlayerRow {
  id: string;
  user_id: string | null;
  club_id: string | null;
  first_name: string;
  last_name: string;
  country: string;
  created_at: Date;
  handicap_index: string | null;
  low_handicap_index: string | null;
}

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    userId: row.user_id,
    clubId: row.club_id,
    firstName: row.first_name,
    lastName: row.last_name,
    country: row.country,
    createdAt: row.created_at.toISOString(),
    handicapIndex: row.handicap_index === null ? null : Number(row.handicap_index),
    lowHandicapIndex: row.low_handicap_index === null ? null : Number(row.low_handicap_index),
  };
}

const SELECT_COLUMNS = "id, user_id, club_id, first_name, last_name, country, created_at, handicap_index, low_handicap_index";

export function createPlayersRepository(pool: Pool): PlayersRepository {
  return {
    // Accepts an optional client so callers (e.g. registration, which must
    // create a user and a player in one transaction -- ghs#8's symmetry
    // fix) can participate in an existing transaction rather than opening
    // a second, unrelated connection.
    async create(input, client) {
      const runner = client ?? pool;
      const result = await runner.query<PlayerRow>(
        `INSERT INTO players (user_id, club_id, first_name, last_name, country)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${SELECT_COLUMNS}`,
        [input.userId ?? null, input.clubId ?? null, input.firstName, input.lastName, input.country ?? "GB"],
      );
      return toPlayer(result.rows[0]!);
    },

    async findByUserId(userId) {
      const result = await pool.query<PlayerRow>(
        `SELECT ${SELECT_COLUMNS} FROM players WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId],
      );
      return result.rows[0] ? toPlayer(result.rows[0]) : null;
    },

    async findByUserIds(userIds) {
      if (userIds.length === 0) return [];
      const result = await pool.query<PlayerRow>(
        `SELECT ${SELECT_COLUMNS} FROM players WHERE user_id = ANY($1) AND deleted_at IS NULL`,
        [userIds],
      );
      return result.rows.map(toPlayer);
    },

    async get(id) {
      const result = await pool.query<PlayerRow>(
        `SELECT ${SELECT_COLUMNS} FROM players WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return result.rows[0] ? toPlayer(result.rows[0]) : null;
    },

    async updateName(id, firstName, lastName) {
      await pool.query(
        "UPDATE players SET first_name = $2, last_name = $3, updated_at = now() WHERE id = $1",
        [id, firstName, lastName],
      );
    },
  };
}
