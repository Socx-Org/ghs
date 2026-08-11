import type { Pool } from "pg";

export type HandicapChangeMethod = "calculated" | "manual_override";

export interface HandicapHistoryRecord {
  id: string;
  playerId: string;
  method: HandicapChangeMethod;
  handicapIndex: number;
  previousIndex: number | null;
  reason: string | null;
  createdBy: string | null;
  calculationSnapshot: Record<string, unknown> | null;
  calculationDate: string;
  createdAt: string;
}

export interface CurrentHandicapIndex {
  handicapIndex: number | null;
  lowHandicapIndex: number | null;
}

export interface RecordHandicapChangeInput {
  playerId: string;
  method: HandicapChangeMethod;
  newIndex: number;
  // Descriptive metadata for the row -- what the caller believed the
  // previous value was. The actual "did this change anything" decision
  // compares newIndex against the real, current players.handicap_index
  // read within this operation's own transaction, not against this
  // field.
  previousIndex: number | null;
  reason: string | null;
  createdBy: string | null;
  calculationSnapshot: Record<string, unknown> | null;
  calculationDate: string; // ISO -- the rolling 365-day Low HI window is anchored to this
}

export interface RecordHandicapChangeResult {
  // null when the new index equals the player's current cached index --
  // a genuine no-op: no history row written, players left untouched.
  // Applies uniformly to both methods (a manual override that "confirms"
  // the current value is still a no-op here) -- handicap_overrides
  // itself is unaffected by this and still gets its own row regardless,
  // since it's a separate, always-append admin-action log (ghs#10).
  history: HandicapHistoryRecord | null;
  handicapIndex: number;
  lowHandicapIndex: number | null;
}

export interface HandicapHistoryRepository {
  getCurrentIndex(playerId: string): Promise<CurrentHandicapIndex | null>;
  listForPlayer(playerId: string): Promise<HandicapHistoryRecord[]>;
  recordChange(input: RecordHandicapChangeInput): Promise<RecordHandicapChangeResult>;
}

interface HandicapHistoryRow {
  id: string;
  player_id: string;
  method: HandicapChangeMethod;
  handicap_index: string;
  previous_index: string | null;
  reason: string | null;
  created_by: string | null;
  calculation_snapshot: Record<string, unknown> | null;
  calculation_date: Date;
  created_at: Date;
}

const HISTORY_COLUMNS = `id, player_id, method, handicap_index, previous_index, reason, created_by, calculation_snapshot, calculation_date, created_at`;

function toRecord(row: HandicapHistoryRow): HandicapHistoryRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    method: row.method,
    handicapIndex: Number(row.handicap_index),
    previousIndex: row.previous_index === null ? null : Number(row.previous_index),
    reason: row.reason,
    createdBy: row.created_by,
    calculationSnapshot: row.calculation_snapshot,
    calculationDate: row.calculation_date.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export function createHandicapHistoryRepository(pool: Pool): HandicapHistoryRepository {
  return {
    async getCurrentIndex(playerId) {
      const result = await pool.query<{ handicap_index: string | null; low_handicap_index: string | null }>(
        "SELECT handicap_index, low_handicap_index FROM players WHERE id = $1 AND deleted_at IS NULL",
        [playerId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        handicapIndex: row.handicap_index === null ? null : Number(row.handicap_index),
        lowHandicapIndex: row.low_handicap_index === null ? null : Number(row.low_handicap_index),
      };
    },

    async listForPlayer(playerId) {
      const result = await pool.query<HandicapHistoryRow>(
        `SELECT ${HISTORY_COLUMNS} FROM handicap_history WHERE player_id = $1 ORDER BY calculation_date DESC`,
        [playerId],
      );
      return result.rows.map(toRecord);
    },

    async recordChange(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Locks the player row for the duration of this transaction so
        // two concurrent recalculations for the same player (e.g. two
        // round approvals landing at once) can't both read the same
        // "current" value and each think their own write is the only
        // change.
        const playerResult = await client.query<{ handicap_index: string | null; low_handicap_index: string | null }>(
          "SELECT handicap_index, low_handicap_index FROM players WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
          [input.playerId],
        );
        const playerRow = playerResult.rows[0];
        if (!playerRow) throw new Error("player not found");

        const currentIndex = playerRow.handicap_index === null ? null : Number(playerRow.handicap_index);
        const currentLow = playerRow.low_handicap_index === null ? null : Number(playerRow.low_handicap_index);

        if (currentIndex !== null && currentIndex === input.newIndex) {
          await client.query("COMMIT");
          return { history: null, handicapIndex: currentIndex, lowHandicapIndex: currentLow };
        }

        const historyResult = await client.query<HandicapHistoryRow>(
          `INSERT INTO handicap_history
           (player_id, method, handicap_index, previous_index, reason, created_by, calculation_snapshot, calculation_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           RETURNING ${HISTORY_COLUMNS}`,
          [
            input.playerId,
            input.method,
            input.newIndex,
            input.previousIndex,
            input.reason,
            input.createdBy,
            input.calculationSnapshot === null ? null : JSON.stringify(input.calculationSnapshot),
            input.calculationDate,
          ],
        );

        // Rolling 365-day Low Handicap Index, anchored to this change's
        // own calculation_date -- not a monotonic running minimum
        // (confirmed against the real, authoritative WHS rule during
        // Phase 2 discovery; legacy's all-time-low is not preserved).
        // The row just inserted above is visible to this query within
        // the same transaction, so it's already included in the MIN
        // without needing a separate Math.min against input.newIndex.
        const lowResult = await client.query<{ low: string | null }>(
          `SELECT MIN(handicap_index) AS low
           FROM handicap_history
           WHERE player_id = $1
             AND calculation_date >= $2::timestamptz - INTERVAL '365 days'`,
          [input.playerId, input.calculationDate],
        );
        const lowHandicapIndex = lowResult.rows[0]!.low === null ? input.newIndex : Number(lowResult.rows[0]!.low);

        await client.query(
          `UPDATE players SET handicap_index = $2, low_handicap_index = $3, updated_at = now() WHERE id = $1`,
          [input.playerId, input.newIndex, lowHandicapIndex],
        );

        await client.query("COMMIT");
        return { history: toRecord(historyResult.rows[0]!), handicapIndex: input.newIndex, lowHandicapIndex };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
