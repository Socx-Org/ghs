import type { Logger } from "@ghs/api/logger";
import type { RetentionRepository } from "../data/retention.repository.ts";

export interface RetentionDeps {
  retention: RetentionRepository;
  logger: Logger;
  sentRetentionDays: number;
  failedRetentionDays: number;
  historyRetentionDays: number;
  deleteBatchSize: number;
}

// ADR-210 point 8 -- bounded, low-frequency (poll-loop.ts calls this on
// its own slower cadence, not every poll cycle). Each delete is capped at
// deleteBatchSize per call; a large backlog is worked off over several
// calls rather than one long lock-holding statement.
export async function runRetentionCleanup(deps: RetentionDeps): Promise<void> {
  const { retention, logger, sentRetentionDays, failedRetentionDays, historyRetentionDays, deleteBatchSize } = deps;

  const deletedSent = await retention.deleteRetiredSentOutbox(sentRetentionDays, deleteBatchSize);
  const deletedFailed = await retention.deleteRetiredFailedOutbox(failedRetentionDays, deleteBatchSize);
  const deletedHistory = await retention.deleteRetiredHistory(historyRetentionDays, deleteBatchSize);

  if (deletedSent > 0 || deletedFailed > 0 || deletedHistory > 0) {
    logger.info("retention cleanup pass", { deletedSent, deletedFailed, deletedHistory });
  }
}
