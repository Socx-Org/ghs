import type { HandicapHistoryRecord } from "../data/handicap-history.repository.ts";
import type { PlayerRoundListItem, PlayerStats } from "../data/rounds.repository.ts";
import type { Logger } from "../logger.ts";
import type { HandicapHistoryService } from "./handicap-history.service.ts";
import type { RoundsService } from "./rounds.service.ts";

// ghs#176 (design doc section E/L.2): per-section failure isolation --
// a genuinely new pattern for this backend (every existing endpoint
// either fully succeeds or fully throws). Each section of the Player
// Dashboard is independently real-data-or-error, so one broken query
// doesn't take down the widgets that didn't depend on it -- matching
// Widget's own per-widget error state on the frontend (design doc
// section F).
export type DashboardSection<T> = { data: T } | { error: true };

export interface PlayerDashboard {
  handicapHistory: DashboardSection<HandicapHistoryRecord[]>;
  recentRounds: DashboardSection<PlayerRoundListItem[]>;
  stats: DashboardSection<PlayerStats>;
}

export interface DashboardService {
  getPlayerDashboard(playerId: string): Promise<PlayerDashboard>;
}

// Review finding, PR #183: toSection previously discarded the error
// entirely -- a real section failure became a silent 200 with no trace
// anywhere (the central Express error handler in app.ts never sees it,
// since the rejection is caught right here), making production
// diagnosis of "why is this widget showing an error" effectively
// impossible. section: a short, stable name (not the raw error), so a
// log line reads "recentRounds failed", not just "something failed".
async function toSection<T>(logger: Logger, section: string, playerId: string, promise: Promise<T>): Promise<DashboardSection<T>> {
  try {
    return { data: await promise };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("dashboard section failed", { section, playerId, error: message });
    return { error: true };
  }
}

export function createDashboardService(handicapHistory: HandicapHistoryService, rounds: RoundsService, logger: Logger): DashboardService {
  return {
    async getPlayerDashboard(playerId) {
      // Promise.all, not sequential awaits -- the three sections are
      // independent reads with no ordering dependency between them, and
      // toSection already contains each one's own failure so a single
      // rejected promise here can't reject the whole Promise.all.
      const [handicapHistorySection, recentRoundsSection, statsSection] = await Promise.all([
        toSection(logger, "handicapHistory", playerId, handicapHistory.listHistoryForPlayer(playerId)),
        toSection(logger, "recentRounds", playerId, rounds.listRoundsForPlayer(playerId)),
        toSection(logger, "stats", playerId, rounds.getPlayerStats(playerId)),
      ]);

      return {
        handicapHistory: handicapHistorySection,
        recentRounds: recentRoundsSection,
        stats: statsSection,
      };
    },
  };
}
