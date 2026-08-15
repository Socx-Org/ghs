import type { Pool } from "pg";

export interface Recipient {
  userId: string;
  email: string;
}

export interface RecipientsRepository {
  // Resolves each notification_history row's recipient fresh, at
  // delivery time, keyed by notification_history_id -- not by reading a
  // copy of the address out of the outbox payload. The four auth-flow
  // events do carry an email in their payload (it's the target of the
  // action itself, e.g. "activate this address"), but the five ghs#25
  // domain events never did, and duplicating a copy of users.email into
  // every payload would let it drift stale if the user's address changed
  // between notification creation and eventual delivery -- user_id is
  // the durable, correct join key (ADR-210's own "enough durable payload
  // info" framing, section 11 of this phase's brief).
  resolveForHistoryIds(historyIds: string[]): Promise<Map<string, Recipient>>;
}

export function createRecipientsRepository(pool: Pool): RecipientsRepository {
  return {
    async resolveForHistoryIds(historyIds) {
      if (historyIds.length === 0) return new Map();

      const result = await pool.query<{ history_id: string; user_id: string; email: string }>(
        `SELECT h.id AS history_id, u.id AS user_id, u.email::text AS email
         FROM notification_history h
         JOIN users u ON u.id = h.user_id
         WHERE h.id = ANY($1::uuid[])`,
        [historyIds],
      );

      const map = new Map<string, Recipient>();
      for (const row of result.rows) {
        map.set(row.history_id, { userId: row.user_id, email: row.email });
      }
      return map;
    },
  };
}
