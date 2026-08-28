import type { HandicapHistoryRecord } from "../data/handicap-history.repository.ts";
import type { PlayerRoundListItem, PlayerStats } from "../data/rounds.repository.ts";
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

async function toSection<T>(promise: Promise<T>): Promise<DashboardSection<T>> {
  try {
    return { data: await promise };
  } catch {
    return { error: true };
  }
}

export function createDashboardService(handicapHistory: HandicapHistoryService, rounds: RoundsService): DashboardService {
  return {
    async getPlayerDashboard(playerId) {
      // Promise.all, not sequential awaits -- the three sections are
      // independent reads with no ordering dependency between them, and
      // toSection already contains each one's own failure so a single
      // rejected promise here can't reject the whole Promise.all.
      const [handicapHistorySection, recentRoundsSection, statsSection] = await Promise.all([
        toSection(handicapHistory.listHistoryForPlayer(playerId)),
        toSection(rounds.listRoundsForPlayer(playerId)),
        toSection(rounds.getPlayerStats(playerId)),
      ]);

      return {
        handicapHistory: handicapHistorySection,
        recentRounds: recentRoundsSection,
        stats: statsSection,
      };
    },
  };
}
