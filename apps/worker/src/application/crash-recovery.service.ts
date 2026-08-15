import type { Logger } from "@ghs/api/logger";
import type { OutboxRepository } from "../data/outbox.repository.ts";
import { nextOutboxState } from "./outbox-state.ts";
import { applyOutboxState } from "./apply-outbox-state.ts";

export interface CrashRecoveryDeps {
  outbox: OutboxRepository;
  logger: Logger;
  timeoutMinutes: number;
  batchSize: number;
  backoffMinutes: readonly number[];
}

// ADR-210 point 7: a row stuck in 'processing' past timeoutMinutes had a
// worker crash (or was killed) between claiming it and recording an
// outcome. Reclaiming MUST be treated as a failed attempt, not a free
// retry -- otherwise a message that reliably crashes the worker on every
// attempt (a poison message) loops forever instead of eventually landing
// in 'failed'. Always retryable, never permanent (point 7's own text):
// the worker cannot know whether the crashed attempt's send actually
// succeeded, so this is conservative, not a real classification of the
// failure itself -- and is exactly the second source of possible
// duplicate delivery point 2 already names and accepts.
export async function runCrashRecoverySweep(deps: CrashRecoveryDeps): Promise<{ reclaimed: number }> {
  const { outbox, logger, timeoutMinutes, batchSize, backoffMinutes } = deps;

  const stuck = await outbox.claimStuckProcessing(timeoutMinutes, batchSize);
  for (const row of stuck) {
    const next = nextOutboxState(row.attempts, true, backoffMinutes);
    await applyOutboxState(outbox, row.id, next, "worker crashed or was terminated while processing this notification (reclaimed)");
    logger.warn("reclaimed stuck notification", {
      outboxId: row.id,
      eventType: row.eventType,
      nextStatus: next.status,
      attempts: next.attempts,
    });
  }

  return { reclaimed: stuck.length };
}
