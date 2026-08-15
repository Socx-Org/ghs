import type { Pool } from "pg";

export interface RetentionRepository {
  // Each bounded to `limit` rows per call (ghs#42's own "bounded,
  // low-frequency" scope) -- a large accumulated backlog is worked off
  // over several retention passes rather than one long lock-holding
  // statement. Returns the number of rows actually deleted, purely for
  // observability logging.
  deleteRetiredSentOutbox(olderThanDays: number, limit: number): Promise<number>;
  deleteRetiredFailedOutbox(olderThanDays: number, limit: number): Promise<number>;
  // notification_history's own, longer retention (ADR-210 point 8) --
  // independent of the outbox cleanup above. By the time a history row
  // is a year old, its own outbox row (7/30-day retention) has already
  // been deleted, so this never races the outbox cleanup or unexpectedly
  // cascades away a live pending/processing row.
  deleteRetiredHistory(olderThanDays: number, limit: number): Promise<number>;
}

export function createRetentionRepository(pool: Pool): RetentionRepository {
  async function deleteRetiredOutboxByStatus(status: "sent" | "failed", olderThanDays: number, limit: number): Promise<number> {
    const result = await pool.query(
      `DELETE FROM notification_outbox
       WHERE id IN (
         SELECT id FROM notification_outbox
         WHERE status = $1 AND updated_at < now() - make_interval(days => $2)
         LIMIT $3
       )`,
      [status, olderThanDays, limit],
    );
    return result.rowCount ?? 0;
  }

  return {
    deleteRetiredSentOutbox: (olderThanDays, limit) => deleteRetiredOutboxByStatus("sent", olderThanDays, limit),
    deleteRetiredFailedOutbox: (olderThanDays, limit) => deleteRetiredOutboxByStatus("failed", olderThanDays, limit),

    async deleteRetiredHistory(olderThanDays, limit) {
      const result = await pool.query(
        `DELETE FROM notification_history
         WHERE id IN (
           SELECT id FROM notification_history
           WHERE created_at < now() - make_interval(days => $1)
           LIMIT $2
         )`,
        [olderThanDays, limit],
      );
      return result.rowCount ?? 0;
    },
  };
}
