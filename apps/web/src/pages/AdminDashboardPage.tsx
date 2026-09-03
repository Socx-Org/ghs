import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, ClipboardCheck, History, LandPlot, Trophy, Users } from "lucide-react";
import { ActiveUsersSparklineWidget, DashboardGrid, EmptyState, KpiStat, RankingList, UserTrendsWidget, Widget } from "../components";
import type { RankingListItem } from "../components";
import { ApiError, getAdminDashboard } from "../lib/api";
import type { AdminDashboardPeriod } from "../lib/api";
import type { CourseCountryBreakdown, CourseRoundRanking, PlayerRoundRanking } from "../types/domain";

// ghs#181 (design doc section C): the real Admin Dashboard, replacing
// DashboardPlaceholder for admin/super_admin -- an operational console
// answering "what's happening across the system, and where do I need
// to act," built on DashboardGrid (#175), fetching from GET
// /dashboard/admin (#180)'s one aggregate, per-section-failure-isolated
// call, same pattern PlayerDashboardPage (#178) already established.

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// RankingList's own established contract (#175/#180): `share` is
// computed client-side, relative to the list's OWN top value -- the
// backend never returns a percentage-of-total for ranking endpoints.
function toShare(value: number, topValue: number): number {
  return topValue > 0 ? (value / topValue) * 100 : 0;
}

function toCourseRankingItems(rankings: CourseRoundRanking[]): RankingListItem[] {
  const topValue = rankings[0]?.roundsCount ?? 0;
  return rankings.map((ranking) => ({
    id: ranking.courseId,
    label: ranking.courseName,
    value: `${ranking.roundsCount} round${ranking.roundsCount === 1 ? "" : "s"}`,
    share: toShare(ranking.roundsCount, topValue),
  }));
}

// ghs#197: "US: 20 courses · GB: 10 courses · Others: 14 courses" --
// raw stored codes, never a display name (matches how a country is
// shown everywhere else in this app, e.g. CourseDetailPage's own
// locationLine). Same middle-dot-joined, manually-pluralized segment
// style as totalUsers' own secondary line below. undefined (no
// secondary line at all) only when there's nothing to show -- zero
// courses.
function formatCourseCountryBreakdown(breakdown: CourseCountryBreakdown): string | undefined {
  const segments = breakdown.topCountries.map(({ country, count }) => `${country}: ${count} course${count === 1 ? "" : "s"}`);
  if (breakdown.others > 0) {
    segments.push(`Others: ${breakdown.others} course${breakdown.others === 1 ? "" : "s"}`);
  }
  return segments.length > 0 ? segments.join(" · ") : undefined;
}

// ghs#199: "18 holes: 9 rounds · 9 holes: 2 rounds" -- unlike
// formatCourseCountryBreakdown's conditional "Others" bucket (an open-
// ended residual), 18-hole/9-hole is a fixed, exhaustive 2-category
// pair, same "always show every category" convention as Total Users'
// own role breakdown -- neither segment is ever omitted, even at zero.
function formatRoundsHoleCountBreakdown(rounds: { eighteenHole: number; nineHole: number }): string {
  return [
    `18 holes: ${rounds.eighteenHole} round${rounds.eighteenHole === 1 ? "" : "s"}`,
    `9 holes: ${rounds.nineHole} round${rounds.nineHole === 1 ? "" : "s"}`,
  ].join(" · ");
}

function toPlayerRankingItems(rankings: PlayerRoundRanking[]): RankingListItem[] {
  const topValue = rankings[0]?.roundsCount ?? 0;
  return rankings.map((ranking) => ({
    id: ranking.playerId,
    label: `${ranking.playerFirstName} ${ranking.playerLastName}`,
    avatarName: `${ranking.playerFirstName} ${ranking.playerLastName}`,
    secondary: ranking.handicapIndex === null ? "No handicap index" : `Handicap index ${ranking.handicapIndex.toFixed(1)}`,
    value: `${ranking.roundsCount} round${ranking.roundsCount === 1 ? "" : "s"}`,
    share: toShare(ranking.roundsCount, topValue),
  }));
}

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<AdminDashboardPeriod>("30d");

  // refetchInterval, not a separate poll just for Active Right Now --
  // one aggregate request already covers every widget (the whole point
  // of #176/#180's per-section design), so keeping that number fresh
  // via a second independent query would just be two requests doing
  // the work of one. 60s matches the heartbeat's own cadence (#179) --
  // polling faster couldn't show anything new.
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", "admin", period],
    queryFn: () => getAdminDashboard(period),
    refetchInterval: 60_000,
  });
  const dashboard = dashboardQuery.data;
  const isLoading = dashboardQuery.isPending;
  const isNetworkError = dashboardQuery.isError;
  const networkErrorMessage = isNetworkError
    ? describeQueryError(dashboardQuery.error, "Couldn't load the dashboard. Try refreshing the page.")
    : undefined;

  const totalUsers = dashboard && "data" in dashboard.totalUsers ? dashboard.totalUsers.data : undefined;
  const totalUsersError = isNetworkError || (dashboard ? "error" in dashboard.totalUsers : false);
  const totalUsersStatus = isLoading ? "loading" : totalUsersError ? "error" : !totalUsers ? "empty" : "ready";

  const totalCourses = dashboard && "data" in dashboard.totalCourses ? dashboard.totalCourses.data : undefined;
  const totalCoursesError = isNetworkError || (dashboard ? "error" in dashboard.totalCourses : false);
  const totalCoursesStatus = isLoading ? "loading" : totalCoursesError ? "error" : totalCourses === undefined ? "empty" : "ready";

  const totalRounds = dashboard && "data" in dashboard.totalRounds ? dashboard.totalRounds.data : undefined;
  const totalRoundsError = isNetworkError || (dashboard ? "error" in dashboard.totalRounds : false);
  const totalRoundsStatus = isLoading ? "loading" : totalRoundsError ? "error" : !totalRounds ? "empty" : "ready";

  const topCourses = dashboard && "data" in dashboard.topCourses ? dashboard.topCourses.data : [];
  const topCoursesError = isNetworkError || (dashboard ? "error" in dashboard.topCourses : false);
  const topCoursesStatus = isLoading ? "loading" : topCoursesError ? "error" : topCourses.length === 0 ? "empty" : "ready";

  const mostActivePlayers = dashboard && "data" in dashboard.mostActivePlayers ? dashboard.mostActivePlayers.data : [];
  const mostActivePlayersError = isNetworkError || (dashboard ? "error" in dashboard.mostActivePlayers : false);
  const mostActivePlayersStatus = isLoading ? "loading" : mostActivePlayersError ? "error" : mostActivePlayers.length === 0 ? "empty" : "ready";

  const activeRightNow = dashboard && "data" in dashboard.activeRightNow ? dashboard.activeRightNow.data : undefined;
  const activeRightNowError = isNetworkError || (dashboard ? "error" in dashboard.activeRightNow : false);

  const userTrends = dashboard && "data" in dashboard.userTrends ? dashboard.userTrends.data : [];
  const userTrendsError = isNetworkError || (dashboard ? "error" in dashboard.userTrends : false);

  return (
    <DashboardGrid className="mx-auto w-full max-w-[1680px] p-4 sm:p-6">
      {/* Design doc's own Mobile section: the 4-widget KPI row collapses
          into one horizontally-scrollable row of small cards on mobile,
          same wrapper/pattern as PlayerDashboardPage's GIR/Sand/
          Penalties row (#178) -- a real CSS grid item (col-span-12) that
          is ALSO a horizontal flex-scroll container below md; at md and
          up it becomes display:contents so its children become direct
          DashboardGrid items with their own md colSpan below. */}
      <div className="col-span-12 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:contents">
        <Widget
          title="Total users"
          icon={Users}
          colSpan={{ md: 3 }}
          className="min-w-[70%] shrink-0 snap-start md:min-w-0"
          status={totalUsersStatus}
          errorMessage={isNetworkError ? networkErrorMessage : undefined}
          emptyState={<EmptyState title="No users yet" />}
        >
          {totalUsers && (
            <KpiStat
              label="Total users"
              value={totalUsers.total}
              secondary={`${totalUsers.player} player${totalUsers.player === 1 ? "" : "s"} · ${totalUsers.admin} admin${totalUsers.admin === 1 ? "" : "s"} · ${totalUsers.superAdmin} super admin${totalUsers.superAdmin === 1 ? "" : "s"}`}
            />
          )}
        </Widget>

        <Widget
          title="Total courses"
          icon={LandPlot}
          colSpan={{ md: 3 }}
          className="min-w-[70%] shrink-0 snap-start md:min-w-0"
          status={totalCoursesStatus}
          errorMessage={isNetworkError ? networkErrorMessage : undefined}
          emptyState={<EmptyState title="No courses yet" />}
        >
          {totalCourses !== undefined && (
            <KpiStat label="Total courses" value={totalCourses.total} secondary={formatCourseCountryBreakdown(totalCourses)} />
          )}
        </Widget>

        <Widget
          title="Total rounds"
          icon={History}
          colSpan={{ md: 3 }}
          className="min-w-[70%] shrink-0 snap-start md:min-w-0"
          status={totalRoundsStatus}
          errorMessage={isNetworkError ? networkErrorMessage : undefined}
          emptyState={<EmptyState title="No rounds yet" />}
        >
          {totalRounds && (
            <KpiStat label="Total rounds" value={totalRounds.total} secondary={formatRoundsHoleCountBreakdown(totalRounds)} />
          )}
        </Widget>

        <Widget
          title="Pending review"
          icon={ClipboardCheck}
          colSpan={{ md: 3 }}
          className="min-w-[70%] shrink-0 snap-start md:min-w-0"
          status={totalRoundsStatus}
          errorMessage={isNetworkError ? networkErrorMessage : undefined}
          emptyState={<EmptyState title="Nothing pending" />}
        >
          {totalRounds && <KpiStat label="Pending review" value={totalRounds.pending} accent={totalRounds.pending > 0 ? "warning" : undefined} />}
        </Widget>
      </div>

      <UserTrendsWidget
        colSpan={{ md: 8 }}
        period={period}
        onPeriodChange={setPeriod}
        isLoading={isLoading}
        isError={userTrendsError}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        data={userTrends}
      />

      <ActiveUsersSparklineWidget
        colSpan={{ md: 4 }}
        isLoading={isLoading}
        isError={activeRightNowError}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        current={activeRightNow?.current}
        period={activeRightNow?.period ?? "24h"}
        series={activeRightNow?.series ?? []}
        previousSeries={activeRightNow?.previousSeries ?? []}
        hasHistory={activeRightNow?.hasHistory ?? false}
      />

      <Widget
        title="Top courses"
        icon={Trophy}
        colSpan={{ md: 6 }}
        status={topCoursesStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No rounds yet" description="Top courses by rounds played will show up here." />}
      >
        <RankingList items={toCourseRankingItems(topCourses)} />
      </Widget>

      <Widget
        title="Most active players"
        icon={Award}
        colSpan={{ md: 6 }}
        status={mostActivePlayersStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No rounds yet" description="Most active players by rounds played will show up here." />}
      >
        <RankingList items={toPlayerRankingItems(mostActivePlayers)} />
      </Widget>
    </DashboardGrid>
  );
}
