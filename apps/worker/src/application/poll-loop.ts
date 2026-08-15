import type { Logger } from "@ghs/api/logger";
import type { SystemSettingsService } from "@ghs/api/application/system-settings.service";
import { runDeliveryCycle, type DeliveryDeps } from "./delivery.service.ts";
import { runCrashRecoverySweep, type CrashRecoveryDeps } from "./crash-recovery.service.ts";
import { runRetentionCleanup, type RetentionDeps } from "./retention.service.ts";

export interface PollLoopDeps {
  logger: Logger;
  systemSettings: SystemSettingsService;
  delivery: DeliveryDeps;
  crashRecovery: CrashRecoveryDeps;
  retention: RetentionDeps;
  retentionIntervalMs: number;
}

export interface PollLoopHandle {
  // Resolves once the currently in-flight cycle (if any) finishes and no
  // further cycles will be scheduled -- not an immediate abort. A single
  // poll cycle is already short (bounded batch size, no external call
  // held open across a DB transaction), so waiting for it to finish
  // rather than interrupting mid-cycle is a deliberate, simple choice:
  // there is nothing here that benefits from a harder cutoff.
  stop(): Promise<void>;
}

// The loop itself (ADR-060: kept separate from delivery/crash-recovery/
// retention's own logic, which are independently testable without any
// interval/scheduling concern at all). Poll interval is read fresh every
// cycle from system_settings (APP-020: read live, not cached, same
// convention as every other setting in this codebase) -- so an operator
// changing it takes effect on the worker's very next cycle, no restart
// needed.
export function startPollLoop(deps: PollLoopDeps): PollLoopHandle {
  const { logger, systemSettings, delivery, crashRecovery, retention, retentionIntervalMs } = deps;

  let stopped = false;
  let lastRetentionAt = 0;

  async function runCycle(): Promise<void> {
    try {
      const delivered = await runDeliveryCycle(delivery);
      const recovered = await runCrashRecoverySweep(crashRecovery);

      if (delivered.claimed > 0 || recovered.reclaimed > 0) {
        logger.info("poll cycle complete", { ...delivered, reclaimed: recovered.reclaimed });
      }

      const now = Date.now();
      if (now - lastRetentionAt >= retentionIntervalMs) {
        lastRetentionAt = now;
        await runRetentionCleanup(retention);
      }
    } catch (err) {
      // One bad cycle must never crash the whole worker (this issue's
      // own scope) -- logged and the loop continues on its next
      // scheduled tick, matching RMS's own per-section error isolation
      // (though RMS isolates per-section within a cycle; here each row
      // within a cycle is already isolated by delivery.service.ts/
      // crash-recovery.service.ts's own per-row try/catch, so this outer
      // catch is the final safety net for anything that still escaped --
      // e.g. a claim query itself failing).
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error("poll cycle failed", { error: message, stack });
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      await runCycle();
      if (stopped) break;
      const intervalSeconds = await systemSettings.getNotificationPollIntervalSeconds();
      await sleep(intervalSeconds * 1000);
    }
  }

  const currentCycle = loop();

  return {
    async stop() {
      stopped = true;
      await currentCycle;
    },
  };
}
