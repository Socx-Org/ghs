import type { Pool } from "pg";

export interface HandicapOverride {
  id: string;
  playerId: string;
  adminUserId: string;
  previousIndex: number | null;
  newIndex: number;
  reason: string;
  createdAt: string;
}

export interface CreateHandicapOverrideInput {
  playerId: string;
  adminUserId: string;
  previousIndex?: number;
  newIndex: number;
  reason: string;
}

// Deliberately append-only (ghs#10's own Domain Behaviour Verification
// requirement): no update or delete method exists on this repository at
// all -- not merely unused, structurally absent, so a future caller
// cannot accidentally mutate override history.
export interface HandicapOverridesRepository {
  create(input: CreateHandicapOverrideInput): Promise<HandicapOverride>;
  listForPlayer(playerId: string): Promise<HandicapOverride[]>;
}

interface HandicapOverrideRow {
  id: string;
  player_id: string;
  admin_user_id: string;
  previous_index: string | null;
  new_index: string;
  reason: string;
  created_at: Date;
}

function toHandicapOverride(row: HandicapOverrideRow): HandicapOverride {
  return {
    id: row.id,
    playerId: row.player_id,
    adminUserId: row.admin_user_id,
    previousIndex: row.previous_index === null ? null : Number(row.previous_index),
    newIndex: Number(row.new_index),
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS = "id, player_id, admin_user_id, previous_index, new_index, reason, created_at";

export function createHandicapOverridesRepository(pool: Pool): HandicapOverridesRepository {
  return {
    async create(input) {
      const result = await pool.query<HandicapOverrideRow>(
        `INSERT INTO handicap_overrides (player_id, admin_user_id, previous_index, new_index, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUMNS}`,
        [input.playerId, input.adminUserId, input.previousIndex ?? null, input.newIndex, input.reason],
      );
      return toHandicapOverride(result.rows[0]!);
    },

    async listForPlayer(playerId) {
      const result = await pool.query<HandicapOverrideRow>(
        `SELECT ${COLUMNS} FROM handicap_overrides WHERE player_id = $1 ORDER BY created_at DESC`,
        [playerId],
      );
      return result.rows.map(toHandicapOverride);
    },
  };
}
