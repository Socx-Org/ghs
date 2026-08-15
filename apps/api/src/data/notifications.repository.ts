import type { Pool, PoolClient } from "pg";

// The full set of real notification-worthy events across the rebuilt
// system (ghs#25's original five, plus the four auth-flow events ghs#39
// migrated off a plaintext-token-logging placeholder onto this same real
// write path).
export type NotificationEventType =
  | "round_submitted"
  | "round_approved"
  | "round_rejected"
  | "handicap_changed"
  | "manual_override"
  | "account_activation"
  | "account_activation_resend"
  | "password_reset"
  | "account_activation_admin_invite";

export interface NotificationHistoryRecord {
  id: string;
  userId: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RecordNotificationInput {
  userId: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
}

export interface RecordNotificationOptions {
  // ghs#41 -- when a preference gates delivery off, the business event
  // still genuinely happened (notification_history exists either way),
  // but no work is created for the worker to ever deliver. Matches
  // ADR-210's own "history without outbox" case. Defaults to true, so
  // every call site from before ghs#41 (all five ghs#25 triggers, all
  // four auth-flow events) is unaffected without being touched.
  enqueue?: boolean;
}

export interface NotificationsRepository {
  // Always writes notification_history. Also writes the child
  // notification_outbox row, in the SAME transaction, on the given
  // client -- ADR-210 point 1 -- unless options.enqueue is explicitly
  // false (ghs#41: a preference gated delivery off, but the business
  // event still genuinely happened). client is a required PoolClient,
  // not optional like most repositories in this codebase: every real
  // caller in this repository's scope already has an open transaction by
  // the time this is called (that's the entire point of the trigger), so
  // there is no legitimate self-managed mode to fall back to here --
  // making the parameter required enforces ADR-210 point 1 structurally
  // rather than only by convention/comment.
  //
  // userId, not playerId (ghs#39): every real notification recipient is
  // fundamentally a user -- a player is a user who also has a player
  // profile, not every user has one (admin/super_admin accounts never
  // do), and not every player has a linked user account either. Callers
  // that start from a playerId resolve the linked userId themselves and
  // skip calling this entirely when there isn't one (there is nothing to
  // notify -- no email address exists anywhere for a player with no
  // linked user).
  record(input: RecordNotificationInput, client: PoolClient, options?: RecordNotificationOptions): Promise<NotificationHistoryRecord>;
  listForUser(userId: string): Promise<NotificationHistoryRecord[]>;
}

interface NotificationHistoryRow {
  id: string;
  user_id: string;
  event_type: NotificationEventType;
  payload: Record<string, unknown>;
  created_at: Date;
}

function toHistoryRecord(row: NotificationHistoryRow): NotificationHistoryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
  };
}

const HISTORY_COLUMNS = "id, user_id, event_type, payload, created_at";

export function createNotificationsRepository(pool: Pool): NotificationsRepository {
  return {
    async record(input, client, options) {
      const historyResult = await client.query<NotificationHistoryRow>(
        `INSERT INTO notification_history (user_id, event_type, payload)
         VALUES ($1, $2, $3::jsonb)
         RETURNING ${HISTORY_COLUMNS}`,
        [input.userId, input.eventType, JSON.stringify(input.payload)],
      );
      const history = toHistoryRecord(historyResult.rows[0]!);

      if (options?.enqueue ?? true) {
        await client.query(
          `INSERT INTO notification_outbox (notification_history_id, event_type, payload)
           VALUES ($1, $2, $3::jsonb)`,
          [history.id, input.eventType, JSON.stringify(input.payload)],
        );
      }

      return history;
    },

    async listForUser(userId) {
      const result = await pool.query<NotificationHistoryRow>(
        `SELECT ${HISTORY_COLUMNS} FROM notification_history WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return result.rows.map(toHistoryRecord);
    },
  };
}
