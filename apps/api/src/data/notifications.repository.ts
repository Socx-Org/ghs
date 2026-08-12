import type { Pool, PoolClient } from "pg";

// ghs#25's fixed domain trigger table (rounds.service.ts, recalculation.
// service.ts, handicap-overrides.service.ts each decide *whether* one of
// these fires; this repository only knows how to write one once a
// caller has already decided to).
export type NotificationEventType =
  | "round_submitted"
  | "round_approved"
  | "round_rejected"
  | "handicap_changed"
  | "manual_override";

export interface NotificationHistoryRecord {
  id: string;
  playerId: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RecordNotificationInput {
  playerId: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
}

export interface NotificationsRepository {
  // Writes notification_history and its child notification_outbox row
  // as one pair of inserts, both on the given client -- ADR-210 point 1
  // requires the outbox record land in the SAME transaction as the
  // business event that triggered it. client is a required PoolClient,
  // not optional like most repositories in this codebase: every real
  // caller in ghs#25's scope already has an open transaction by the time
  // this is called (that's the entire point of the trigger), so there is
  // no legitimate self-managed mode to fall back to here -- making the
  // parameter required enforces ADR-210 point 1 structurally rather than
  // only by convention/comment.
  record(input: RecordNotificationInput, client: PoolClient): Promise<NotificationHistoryRecord>;
  listForPlayer(playerId: string): Promise<NotificationHistoryRecord[]>;
}

interface NotificationHistoryRow {
  id: string;
  player_id: string;
  event_type: NotificationEventType;
  payload: Record<string, unknown>;
  created_at: Date;
}

function toHistoryRecord(row: NotificationHistoryRow): NotificationHistoryRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
  };
}

const HISTORY_COLUMNS = "id, player_id, event_type, payload, created_at";

export function createNotificationsRepository(pool: Pool): NotificationsRepository {
  return {
    async record(input, client) {
      const historyResult = await client.query<NotificationHistoryRow>(
        `INSERT INTO notification_history (player_id, event_type, payload)
         VALUES ($1, $2, $3::jsonb)
         RETURNING ${HISTORY_COLUMNS}`,
        [input.playerId, input.eventType, JSON.stringify(input.payload)],
      );
      const history = toHistoryRecord(historyResult.rows[0]!);

      await client.query(
        `INSERT INTO notification_outbox (notification_history_id, event_type, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [history.id, input.eventType, JSON.stringify(input.payload)],
      );

      return history;
    },

    async listForPlayer(playerId) {
      const result = await pool.query<NotificationHistoryRow>(
        `SELECT ${HISTORY_COLUMNS} FROM notification_history WHERE player_id = $1 ORDER BY created_at DESC`,
        [playerId],
      );
      return result.rows.map(toHistoryRecord);
    },
  };
}
