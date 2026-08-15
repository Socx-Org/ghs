import type { EmailProvider } from "@ghs/api/lib/email";
import type { NotificationEventType } from "@ghs/api/data/notifications.repository";
import type { Logger } from "@ghs/api/logger";
import type { OutboxRepository } from "../data/outbox.repository.ts";
import type { RecipientsRepository } from "../data/recipients.repository.ts";
import { nextOutboxState } from "./outbox-state.ts";
import { classifyFailure } from "./classify.ts";
import { renderNotification } from "./templates.ts";
import { applyOutboxState } from "./apply-outbox-state.ts";

export interface DeliveryDeps {
  outbox: OutboxRepository;
  recipients: RecipientsRepository;
  provider: EmailProvider;
  logger: Logger;
  appBaseUrl: string;
  batchSize: number;
  backoffMinutes: readonly number[];
}

// One poll cycle's delivery pass: claim -> resolve recipients -> render ->
// send -> update, with each row's outcome isolated from every other row's
// (ADR-060: this is the "deliver" layer, kept separate from poll-loop.ts's
// own cycle/interval concerns and from crash-recovery.service.ts).
export async function runDeliveryCycle(deps: DeliveryDeps): Promise<{ claimed: number; sent: number; failed: number }> {
  const { outbox, recipients, provider, logger, appBaseUrl, batchSize, backoffMinutes } = deps;

  const batch = await outbox.claimBatch(batchSize);
  if (batch.length === 0) return { claimed: 0, sent: 0, failed: 0 };

  const recipientMap = await recipients.resolveForHistoryIds(batch.map((row) => row.notificationHistoryId));

  let sent = 0;
  let failed = 0;

  for (const row of batch) {
    const queuedForMs = Date.now() - new Date(row.createdAt).getTime();
    const startedAt = Date.now();
    try {
      const recipient = recipientMap.get(row.notificationHistoryId);
      if (!recipient) {
        // Should not happen given notification_history.user_id's NOT
        // NULL FK to users(id) -- but a claimed row this repository
        // cannot address is unrecoverable by definition, not a
        // transient condition, so it's permanent, not retryable.
        const next = nextOutboxState(row.attempts, false, backoffMinutes);
        await applyOutboxState(outbox, row.id, next, "no recipient user found for this notification");
        failed++;
        logger.warn("notification delivery failed: no recipient", { outboxId: row.id, eventType: row.eventType, status: next.status });
        continue;
      }

      const message = renderNotification(row.eventType as NotificationEventType, row.payload, appBaseUrl);
      await provider.send({ to: recipient.email, subject: message.subject, text: message.text, html: message.html });
      // attempts includes this successful send itself (PR #47 review fix:
      // a previous version left attempts unchanged on success, so the
      // count undercounted by one, and left a prior failed attempt's
      // stale retry_after/failure_reason sitting on an otherwise-sent
      // row -- markSent now clears both, same as markFailed already
      // clears retry_after).
      await outbox.markSent(row.id, row.attempts + 1);
      sent++;

      // Observability (ADR-210 point 9): queueing/processing latency,
      // attempt count, final status -- never the recipient address,
      // token, or message body (SEC-010; a raw token would otherwise
      // appear right here in the payload this loop already has in
      // memory -- deliberately not logged).
      logger.info("notification delivered", {
        outboxId: row.id,
        eventType: row.eventType,
        attempts: row.attempts + 1,
        queuedForMs,
        processingMs: Date.now() - startedAt,
      });
    } catch (err) {
      const retryable = classifyFailure(err) === "retryable";
      const next = nextOutboxState(row.attempts, retryable, backoffMinutes);
      const reason = err instanceof Error ? err.message : String(err);
      await applyOutboxState(outbox, row.id, next, reason);
      failed++;

      logger.warn("notification delivery failed", {
        outboxId: row.id,
        eventType: row.eventType,
        retryable,
        nextStatus: next.status,
        attempts: next.attempts,
        processingMs: Date.now() - startedAt,
      });
    }
  }

  return { claimed: batch.length, sent, failed };
}
