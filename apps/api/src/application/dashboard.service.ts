import type { HandicapHistoryRecord } from "../data/handicap-history.repository.ts";
import type { CourseRoundRanking, PlayerRoundListItem, PlayerRoundRanking, PlayerStats } from "../data/rounds.repository.ts";
import type { RegistrationTrendPoint, UserRoleBreakdown, UsersRepository } from "../data/users.repository.ts";
import type { CoursesRepository } from "../data/courses.repository.ts";
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

// ghs#180 (design doc sections C/E): GET /dashboard/admin's own
// per-section response shape -- same failure-isolation pattern as
// PlayerDashboard. totalRounds carries both the grand total and the
// pending-review count together (one widget, two numbers, design doc's
// own "split into two KPIs" framing) rather than two separate top-level
// sections for what's really one query.
export interface AdminDashboard {
  totalUsers: DashboardSection<UserRoleBreakdown>;
  totalCourses: DashboardSection<number>;
  totalRounds: DashboardSection<{ total: number; pending: number }>;
  topCourses: DashboardSection<CourseRoundRanking[]>;
  mostActivePlayers: DashboardSection<PlayerRoundRanking[]>;
  activeRightNow: DashboardSection<number>;
  userTrends: DashboardSection<RegistrationTrendPoint[]>;
}

export interface DashboardService {
  getPlayerDashboard(playerId: string): Promise<PlayerDashboard>;
  // days: the real window size in days (7/30/90) -- validated at the
  // HTTP boundary (dashboard.ts), not re-validated here.
  getAdminDashboard(days: number): Promise<AdminDashboard>;
}

const TOP_RANKING_LIMIT = 5;

// Review finding, PR #183: toSection previously discarded the error
// entirely -- a real section failure became a silent 200 with no trace
// anywhere (the central Express error handler in app.ts never sees it,
// since the rejection is caught right here), making production
// diagnosis of "why is this widget showing an error" effectively
// impossible. section: a short, stable name (not the raw error), so a
// log line reads "recentRounds failed", not just "something failed".
// context: whatever identifies the caller worth logging alongside it --
// a playerId for the Player Dashboard, nothing in particular for the
// Admin Dashboard (there's no single "owner" of that request) -- kept
// generic here rather than hardcoding a playerId field this admin-side
// caller has no real value for.
async function toSection<T>(logger: Logger, section: string, context: Record<string, unknown>, promise: Promise<T>): Promise<DashboardSection<T>> {
  try {
    return { data: await promise };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("dashboard section failed", { section, ...context, error: message });
    return { error: true };
  }
}

export function createDashboardService(
  handicapHistory: HandicapHistoryService,
  rounds: RoundsService,
  users: UsersRepository,
  courses: CoursesRepository,
  logger: Logger,
): DashboardService {
  return {
    async getPlayerDashboard(playerId) {
      // Promise.all, not sequential awaits -- the three sections are
      // independent reads with no ordering dependency between them, and
      // toSection already contains each one's own failure so a single
      // rejected promise here can't reject the whole Promise.all.
      const [handicapHistorySection, recentRoundsSection, statsSection] = await Promise.all([
        toSection(logger, "handicapHistory", { playerId }, handicapHistory.listHistoryForPlayer(playerId)),
        toSection(logger, "recentRounds", { playerId }, rounds.listRoundsForPlayer(playerId)),
        toSection(logger, "stats", { playerId }, rounds.getPlayerStats(playerId)),
      ]);

      return {
        handicapHistory: handicapHistorySection,
        recentRounds: recentRoundsSection,
        stats: statsSection,
      };
    },

    async getAdminDashboard(days) {
      const [totalUsersSection, totalCoursesSection, totalRoundsSection, topCoursesSection, mostActivePlayersSection, activeRightNowSection, userTrendsSection] =
        await Promise.all([
          toSection(logger, "totalUsers", {}, users.getRoleBreakdown()),
          // CoursesRepository.list() is already a lightweight, unpaginated
          // query (courses.repository.ts's own list() -- no tee_configurations
          // join) -- .length works client-side today, same shortcut the
          // design doc itself calls out ("doesn't scale once course
          // pagination lands," an accepted, documented tradeoff, not an
          // oversight).
          toSection(logger, "totalCourses", {}, courses.list().then((list) => list.length)),
          // Reuses the existing, already-proven listAdminRounds query
          // (ghs#100/#113) for both numbers -- limit: 1 since only the
          // real COUNT(*) it already computes is needed, not the rows.
          toSection(logger, "totalRounds", {}, (async () => {
            const [totalResult, pendingResult] = await Promise.all([
              rounds.listAdminRounds({ limit: 1, offset: 0 }),
              rounds.listAdminRounds({ status: "pending", limit: 1, offset: 0 }),
            ]);
            return { total: totalResult.total, pending: pendingResult.total };
          })()),
          toSection(logger, "topCourses", {}, rounds.getTopCourses(TOP_RANKING_LIMIT)),
          toSection(logger, "mostActivePlayers", {}, rounds.getMostActivePlayers(TOP_RANKING_LIMIT)),
          toSection(logger, "activeRightNow", {}, users.countActiveNow()),
          toSection(logger, "userTrends", { days }, users.getRegistrationTrend(days)),
        ]);

      return {
        totalUsers: totalUsersSection,
        totalCourses: totalCoursesSection,
        totalRounds: totalRoundsSection,
        topCourses: topCoursesSection,
        mostActivePlayers: mostActivePlayersSection,
        activeRightNow: activeRightNowSection,
        userTrends: userTrendsSection,
      };
    },
  };
}
