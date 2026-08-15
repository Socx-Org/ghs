import type { OutboxRepository } from "../data/outbox.repository.ts";
import type { OutboxNextState } from "./outbox-state.ts";

// Shared by delivery.service.ts (a real send failure) and
// crash-recovery.service.ts (a reclaimed stuck row) -- both ultimately
// just apply whatever nextOutboxState() decided.
export async function applyOutboxState(outbox: OutboxRepository, id: string, next: OutboxNextState, reason: string): Promise<void> {
  if (next.status === "failed") {
    await outbox.markFailed(id, next.attempts, reason);
  } else {
    await outbox.markPendingRetry(id, next.attempts, next.retryAfter, reason);
  }
}
