import type { HandicapHistoryRecord } from "../data/handicap-history.repository.ts";
import type { CourseRoundRanking, PlayerRoundListItem, PlayerRoundRanking, PlayerStats } from "../data/rounds.repository.ts";
import type { RegistrationTrendPoint, UserRoleBreakdown, UsersRepository } from "../data/users.repository.ts";
import type { PresenceSnapshotSeriesPoint, PresenceSnapshotsRepository } from "../data/presence-snapshots.repository.ts";
import type { CourseCountryBreakdown, CoursesRepository } from "../data/courses.repository.ts";
import type { Logger } from "../logger.ts";
import type { HandicapHistoryService } from "./handicap-history.service.ts";
import type { RoundsService } from "./rounds.service.ts";
import type { ActiveUsersChartPeriod, SystemSettingsService } from "./system-settings.service.ts";

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
// ghs#195: activeRightNow's own richer shape -- the live 5-minute count
// (unchanged, still users.countActiveNow()) plus a current-vs-previous
// bucketed history for the sparkline. `period` is echoed back so the
// frontend never has to independently track which admin setting produced
// this particular series.
export interface ActiveUsersSnapshot {
  current: number;
  period: ActiveUsersChartPeriod;
  series: PresenceSnapshotSeriesPoint[];
  previousSeries: PresenceSnapshotSeriesPoint[];
  // False until the worker's periodic snapshot task has recorded at
  // least one row -- distinguishes "no history collected yet" (an
  // unavoidable cold start; there's nothing to backfill) from a real,
  // legitimately zero-filled series. The frontend renders a "collecting
  // history" state rather than a flatlined-at-zero chart while this is
  // false.
  hasHistory: boolean;
}

export interface AdminDashboard {
  totalUsers: DashboardSection<UserRoleBreakdown>;
  // ghs#197: total + a top-2-country breakdown, same "structured data
  // in, display string built by the frontend" split as totalUsers above.
  totalCourses: DashboardSection<CourseCountryBreakdown>;
  totalRounds: DashboardSection<{ total: number; pending: number }>;
  topCourses: DashboardSection<CourseRoundRanking[]>;
  mostActivePlayers: DashboardSection<PlayerRoundRanking[]>;
  activeRightNow: DashboardSection<ActiveUsersSnapshot>;
  userTrends: DashboardSection<RegistrationTrendPoint[]>;
}

export interface DashboardService {
  getPlayerDashboard(playerId: string): Promise<PlayerDashboard>;
  // days: the real window size in days (7/30/90) -- validated at the
  // HTTP boundary (dashboard.ts), not re-validated here.
  getAdminDashboard(days: number): Promise<AdminDashboard>;
}

const TOP_RANKING_LIMIT = 5;

// ghs#195: each admin-configurable period maps to a real bucket width and
// a real window size -- current window is [now - windowMs, now), previous
// window is the same width immediately before it ([now - 2*windowMs, now
// - windowMs)), so the two series are always directly comparable
// (same number of buckets, same bucket width). windowMs is always an
// exact multiple of bucketIntervalMs for every period below -- load-
// bearing for alignBucketEnd's own stability guarantee (see its comment).
interface ActiveUsersPeriodWindow {
  bucketInterval: string;
  bucketIntervalMs: number;
  windowMs: number;
}

const ACTIVE_USERS_PERIOD_WINDOWS: Record<ActiveUsersChartPeriod, ActiveUsersPeriodWindow> = {
  "24h": { bucketInterval: "15 minutes", bucketIntervalMs: 15 * 60 * 1000, windowMs: 24 * 60 * 60 * 1000 },
  week: { bucketInterval: "1 hour", bucketIntervalMs: 60 * 60 * 1000, windowMs: 7 * 24 * 60 * 60 * 1000 },
  month: { bucketInterval: "1 day", bucketIntervalMs: 24 * 60 * 60 * 1000, windowMs: 30 * 24 * 60 * 60 * 1000 },
};

// Review finding, PR #196: the series' own range/bucket boundaries were
// previously anchored to raw request-time `now`, which drifts on every
// request -- date_bin's origin (getSeries' own rangeStart) shifted along
// with it, so the exact same stored snapshot could land in a visibly
// different bucket on the next 60s dashboard poll, reading as jitter with
// no underlying data change. Flooring to the nearest completed bucket
// boundary, relative to the fixed Unix epoch (not to `now` itself), gives
// every request the same stable bucket grid -- the trailing, still-
// filling bucket is deliberately excluded from the series entirely
// (rangeEnd is the start of the CURRENT bucket, not partway through it),
// which is why the live, always-current count above is a separate field
// (`current`) rather than folded into the series as its own last point.
function alignBucketEnd(now: Date, bucketIntervalMs: number): Date {
  return new Date(Math.floor(now.getTime() / bucketIntervalMs) * bucketIntervalMs);
}

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
  presenceSnapshots: PresenceSnapshotsRepository,
  systemSettings: SystemSettingsService,
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
          // ghs#197: was courses.list().then(list => list.length) -- a
          // real GROUP BY aggregation now, since the widget needs the
          // per-country counts, not just the total.
          toSection(logger, "totalCourses", {}, courses.getCountryBreakdown()),
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
          // ghs#195: period is read live from system_settings inside this
          // section's own promise (APP-020: never cached), so a slow or
          // failing settings read only ever fails this one section, same
          // isolation every other section already gets.
          toSection(
            logger,
            "activeRightNow",
            {},
            (async (): Promise<ActiveUsersSnapshot> => {
              const period = await systemSettings.getActiveUsersChartPeriod();
              const { bucketInterval, bucketIntervalMs, windowMs } = ACTIVE_USERS_PERIOD_WINDOWS[period];
              const rangeEnd = alignBucketEnd(new Date(), bucketIntervalMs);
              const currentStart = new Date(rangeEnd.getTime() - windowMs);
              const previousStart = new Date(rangeEnd.getTime() - 2 * windowMs);
              const [current, series, previousSeries, hasHistory] = await Promise.all([
                users.countActiveNow(),
                presenceSnapshots.getSeries(currentStart, rangeEnd, bucketInterval),
                presenceSnapshots.getSeries(previousStart, currentStart, bucketInterval),
                presenceSnapshots.hasAnySnapshot(),
              ]);
              return { current, period, series, previousSeries, hasHistory };
            })(),
          ),
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
