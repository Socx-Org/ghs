import type { Pool } from "pg";

export type OutboxStatus = "pending" | "processing" | "sent" | "failed";

export interface OutboxRow {
  id: string;
  notificationHistoryId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  claimedAt: string | null;
  retryAfter: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OutboxDbRow {
  id: string;
  notification_history_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  claimed_at: Date | null;
  retry_after: Date | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function toOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    notificationHistoryId: row.notification_history_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    claimedAt: row.claimed_at ? row.claimed_at.toISOString() : null,
    retryAfter: row.retry_after ? row.retry_after.toISOString() : null,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLUMNS =
  "id, notification_history_id, event_type, payload, status, attempts, claimed_at, retry_after, failure_reason, created_at, updated_at";

export interface OutboxRepository {
  // Single atomic claim (ADR-210 point 6, this issue's own scope): claims
  // up to batchSize pending-and-eligible rows in one statement. Always
  // its own short, self-contained transaction -- a single UPDATE is
  // already atomic on its own, no explicit BEGIN/COMMIT needed, and
  // there is never a longer-lived caller transaction to thread into (the
  // worker has no such concept -- unlike apps/api's notifications.
  // repository.ts, nothing here needs to commit or roll back together
  // with an unrelated business write).
  claimBatch(batchSize: number): Promise<OutboxRow[]>;

  // Crash recovery (ADR-210 point 7): atomically refreshes claimed_at on
  // rows stuck in 'processing' past timeoutMinutes, so a concurrent sweep
  // can't grab the same stuck row again immediately after. Callers must
  // still push the returned rows through markPendingRetry/markFailed
  // (via outbox-state.ts's nextOutboxState, with retryable=true always,
  // per ADR-210 point 7) -- this only reclaims the row, it doesn't decide
  // the row's next status itself.
  claimStuckProcessing(timeoutMinutes: number, batchSize: number): Promise<OutboxRow[]>;

  // attempts: the caller passes the count including this successful send
  // itself (PR #47 review fix) -- and retry_after/failure_reason are
  // always cleared on success, so a row that failed once before finally
  // succeeding doesn't keep showing a stale failure reason or a
  // meaningless future retry_after once it's actually sent.
  markSent(id: string, attempts: number): Promise<void>;
  markPendingRetry(id: string, attempts: number, retryAfter: Date, failureReason: string): Promise<void>;
  markFailed(id: string, attempts: number, failureReason: string): Promise<void>;
}

export function createOutboxRepository(pool: Pool): OutboxRepository {
  return {
    async claimBatch(batchSize) {
      const result = await pool.query<OutboxDbRow>(
        `UPDATE notification_outbox
         SET status = 'processing', claimed_at = now(), updated_at = now()
         WHERE id IN (
           SELECT id FROM notification_outbox
           WHERE status = 'pending' AND (retry_after IS NULL OR retry_after <= now())
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING ${COLUMNS}`,
        [batchSize],
      );
      return result.rows.map(toOutboxRow);
    },

    async claimStuckProcessing(timeoutMinutes, batchSize) {
      const result = await pool.query<OutboxDbRow>(
        `UPDATE notification_outbox
         SET claimed_at = now()
         WHERE id IN (
           SELECT id FROM notification_outbox
           WHERE status = 'processing' AND claimed_at < now() - make_interval(mins => $1)
           ORDER BY claimed_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         RETURNING ${COLUMNS}`,
        [timeoutMinutes, batchSize],
      );
      return result.rows.map(toOutboxRow);
    },

    async markSent(id, attempts) {
      await pool.query(
        `UPDATE notification_outbox
         SET status = 'sent', attempts = $2, retry_after = NULL, failure_reason = NULL, updated_at = now()
         WHERE id = $1`,
        [id, attempts],
      );
    },

    async markPendingRetry(id, attempts, retryAfter, failureReason) {
      await pool.query(
        `UPDATE notification_outbox
         SET status = 'pending', attempts = $2, retry_after = $3, failure_reason = $4, updated_at = now()
         WHERE id = $1`,
        [id, attempts, retryAfter, failureReason],
      );
    },

    async markFailed(id, attempts, failureReason) {
      await pool.query(
        `UPDATE notification_outbox
         SET status = 'failed', attempts = $2, retry_after = NULL, failure_reason = $3, updated_at = now()
         WHERE id = $1`,
        [id, attempts, failureReason],
      );
    },
  };
}
