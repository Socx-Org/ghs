import { createPool } from "@ghs/api/data/pool";
import { createLogger } from "@ghs/api/logger";
import { createEmailProvider } from "@ghs/api/lib/email";
import { createSystemSettingsRepository } from "@ghs/api/data/system-settings.repository";
import { createSystemSettingsService } from "@ghs/api/application/system-settings.service";
import { loadWorkerConfig } from "./config.ts";
import { createOutboxRepository } from "./data/outbox.repository.ts";
import { createRecipientsRepository } from "./data/recipients.repository.ts";
import { createRetentionRepository } from "./data/retention.repository.ts";
import { startPollLoop } from "./application/poll-loop.ts";
import {
  RETRY_BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  CRASH_RECOVERY_TIMEOUT_MINUTES,
  SENT_RETENTION_DAYS,
  FAILED_RETENTION_DAYS,
  HISTORY_RETENTION_DAYS,
  BATCH_SIZE,
  RETENTION_CLEANUP_INTERVAL_MS,
  RETENTION_DELETE_BATCH_SIZE,
} from "./constants.ts";

// Composition root (APP-010, ADR-130): config and secrets are read
// exactly once, here, and passed down -- same convention as apps/api's
// own src/index.ts.
const config = loadWorkerConfig();
const logger = createLogger(config.serviceName);

const pool = createPool(config.database);
const provider = createEmailProvider(config.email);

const outbox = createOutboxRepository(pool);
const recipients = createRecipientsRepository(pool);
const retention = createRetentionRepository(pool);
const systemSettings = createSystemSettingsService(createSystemSettingsRepository(pool));

logger.info("worker starting", { env: config.env, emailProvider: config.email.provider });

const handle = startPollLoop({
  logger,
  systemSettings,
  delivery: {
    outbox,
    recipients,
    provider,
    logger,
    appBaseUrl: config.appBaseUrl,
    batchSize: BATCH_SIZE,
    backoffMinutes: RETRY_BACKOFF_MINUTES,
    maxAttempts: MAX_ATTEMPTS,
  },
  crashRecovery: {
    outbox,
    logger,
    timeoutMinutes: CRASH_RECOVERY_TIMEOUT_MINUTES,
    batchSize: BATCH_SIZE,
    backoffMinutes: RETRY_BACKOFF_MINUTES,
    maxAttempts: MAX_ATTEMPTS,
  },
  retention: {
    retention,
    logger,
    sentRetentionDays: SENT_RETENTION_DAYS,
    failedRetentionDays: FAILED_RETENTION_DAYS,
    historyRetentionDays: HISTORY_RETENTION_DAYS,
    deleteBatchSize: RETENTION_DELETE_BATCH_SIZE,
  },
  retentionIntervalMs: RETENTION_CLEANUP_INTERVAL_MS,
});

async function shutdown(signal: string): Promise<void> {
  logger.info("shutting down", { signal });
  await handle.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
