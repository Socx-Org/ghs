import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, CircleDot, Plus, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, DashboardGrid, EmptyState, HandicapTrendWidget, KpiStat, RecentRoundsWidget, SegmentedBar, Widget } from "../components";
import { ApiError, getPlayerDashboard } from "../lib/api";
import type { PlayerStats } from "../types/domain";

// ghs#65: the player's real landing screen after login -- current
// handicap index and recent rounds.
//
// ghs#178 (design doc section B): rebuilt on DashboardGrid, fetching
// from GET /dashboard/player (ghs#176) instead of 3 independent
// queries -- one query, three independently-failable sections
// (handicapHistory/recentRounds/stats), so each widget derives its own
// status from its OWN section only, never from the other two. That's
// the entire point of the backend's per-section failure isolation:
// e.g. a broken stats query must not blank out the handicap trend
// chart, which has nothing to do with it.

// Surfaces the API's own message (e.g. a real network/auth failure)
// rather than a fixed generic string -- same reasoning as LoginPage's
// describeAuthError (review finding, PR #91). Only meaningful for a
// failure of the aggregate call itself (isNetworkError below) -- an
// individual section's own { error: true } marker carries no message
// by design (per-section isolation deliberately doesn't leak backend
// error text per section), so those fall back to Widget's own generic
// default instead.
function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function percentLabel(value: number | null): string {
  return value === null ? "--" : `${value}%`;
}

// ghs#176 (design doc section B): 2-putt isn't a real column -- it
// falls out as the remainder once 1-putt and 3+-putt holes are known,
// same simplification the design doc itself specifies (this also
// folds a genuine 0-putt hole, e.g. a holed approach shot, into the
// same bucket -- rare enough, and specific enough to WHS scoring, that
// inventing a 4th segment for it isn't worth the added complexity the
// design doc didn't ask for). Denominator is puttsHolesCount, not
// holesCount (review fix, PR #184) -- putts is nullable per hole, so a
// holesCount-based remainder would silently absorb every hole with no
// real putts data into "2-putt."
function twoPuttHoles(stats: PlayerStats): number {
  return Math.max(0, stats.puttsHolesCount - stats.onePuttHoles - stats.threePlusPuttHoles);
}

type SectionStatus = "loading" | "error" | "empty" | "ready";

// ghs#96: no header/logo/sign-out here any more -- AppShell now
// provides that chrome uniformly for every authenticated page.
export default function PlayerDashboardPage() {
  const navigate = useNavigate();

  const dashboardQuery = useQuery({ queryKey: ["dashboard", "player"], queryFn: getPlayerDashboard });
  const dashboard = dashboardQuery.data;
  const isLoading = dashboardQuery.isPending;
  // The aggregate request itself failed (network/auth/5xx) -- distinct
  // from a single section's own { error: true } marker. A whole-request
  // failure means every widget shows an error, but (unlike a per-
  // section failure) a real message is available to show.
  const isNetworkError = dashboardQuery.isError;
  const networkErrorMessage = isNetworkError
    ? describeQueryError(dashboardQuery.error, "Couldn't load your dashboard. Try refreshing the page.")
    : undefined;

  const history = dashboard && "data" in dashboard.handicapHistory ? dashboard.handicapHistory.data : [];
  const historyError = isNetworkError || (dashboard ? "error" in dashboard.handicapHistory : false);

  const rounds = dashboard && "data" in dashboard.recentRounds ? dashboard.recentRounds.data : [];
  const roundsError = isNetworkError || (dashboard ? "error" in dashboard.recentRounds : false);

  const stats = dashboard && "data" in dashboard.stats ? dashboard.stats.data : undefined;
  const statsError = isNetworkError || (dashboard ? "error" in dashboard.stats : false);
  // Every stats-derived widget (Activity/FIR/Putting/GIR/Sand/Penalties)
  // shares this one status -- they all come from the same PlayerStats
  // object, so there's no scenario where one is empty/ready while
  // another is loading/errored.
  const statsStatus: SectionStatus = isLoading ? "loading" : statsError ? "error" : !stats || stats.roundsCount === 0 ? "empty" : "ready";
  // Review fix, PR #184: FIR/Putting need their OWN empty condition on
  // top of statsStatus -- a player can have real approved rounds
  // (statsStatus "ready") while still having no fairway-relevant holes
  // (fairwayHitPercentage null) or no putts recorded at all
  // (puttsHolesCount 0). Rendering "ready" in either case would show a
  // broken-looking "--" headline and a 0/0/0 bar instead of the real,
  // specific empty state these widgets already have.
  const firStatus: SectionStatus = statsStatus === "ready" && stats?.fairwayHitPercentage === null ? "empty" : statsStatus;
  const puttingStatus: SectionStatus = statsStatus === "ready" && stats?.puttsHolesCount === 0 ? "empty" : statsStatus;

  return (
    <DashboardGrid className="mx-auto w-full max-w-[1680px] p-4 sm:p-6">
      <HandicapTrendWidget
        colSpan={{ lg: 8 }}
        isLoading={isLoading}
        isError={historyError}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        history={history}
      />

      {/* Design doc section D/B: rounds played is the headline (KpiStat),
          distinct courses played is the secondary line -- Widget's own
          secondaryMetric header slot, not a second KpiStat value.
          order-last on mobile: desktop wants Activity right after the
          trend chart (row 1), but mobile wants it LAST (design doc's
          own mobile order) -- reset at md so tablet keeps desktop's
          order. Every other widget below already lands in the right
          mobile position via plain DOM order, so this is the only
          reorder needed on the whole page. */}
      <Widget
        title="Activity"
        icon={ActivityIcon}
        colSpan={{ lg: 4 }}
        className="order-last md:order-none"
        status={statsStatus}
        secondaryMetric={stats ? `${stats.coursesCount} course${stats.coursesCount === 1 ? "" : "s"}` : undefined}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No rounds yet" description="Play and get a round approved to see your activity here." />}
      >
        {stats && <KpiStat label="Rounds played" value={stats.roundsCount} />}
      </Widget>

      <RecentRoundsWidget
        colSpan={{ md: 6 }}
        isLoading={isLoading}
        isError={roundsError}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        rounds={rounds}
        onContinue={(roundId) => navigate(`/rounds/${roundId}`)}
        actions={
          <Button size="sm" icon={<Plus aria-hidden="true" className="h-4 w-4" />} onClick={() => navigate("/rounds/new")}>
            New round
          </Button>
        }
      />

      <Widget
        title="Fairways in regulation"
        icon={Target}
        colSpan={{ md: 6 }}
        status={firStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No fairway data yet" description="Approved rounds with a recorded fairway result will show up here." />}
      >
        {stats && (
          <SegmentedBar
            headline={percentLabel(stats.fairwayHitPercentage)}
            headlineLabel="Fairways hit"
            segments={[
              { label: "Missed left", value: stats.fairwayMissedLeftPercentage ?? 0, colorClass: "bg-danger" },
              { label: "Hit", value: stats.fairwayHitPercentage ?? 0, colorClass: "bg-success" },
              { label: "Missed right", value: stats.fairwayMissedRightPercentage ?? 0, colorClass: "bg-warning" },
            ]}
          />
        )}
      </Widget>

      <Widget
        title="Putting"
        icon={CircleDot}
        colSpan={{ lg: 6 }}
        status={puttingStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No putting data yet" description="Approved rounds with recorded putts will show up here." />}
      >
        {stats && (
          <SegmentedBar
            headline={stats.puttsPerRound === null ? "--" : `${stats.puttsPerRound} putts/round`}
            segments={[
              { label: "1-putt", value: (stats.onePuttHoles / stats.puttsHolesCount) * 100, colorClass: "bg-success" },
              { label: "2-putt", value: (twoPuttHoles(stats) / stats.puttsHolesCount) * 100, colorClass: "bg-primary" },
              { label: "3+ putt", value: (stats.threePlusPuttHoles / stats.puttsHolesCount) * 100, colorClass: "bg-warning" },
            ]}
          />
        )}
      </Widget>

      {/* Design doc's own Mobile section: GIR/Sand/Penalties collapse
          into one horizontally-scrollable row of small cards on mobile,
          not three full-width stacked rows -- a full-width card for a
          single number wastes most of a phone's width. This wrapper is
          a real CSS grid item (col-span-12) that's ALSO a horizontal
          flex-scroll container below md; at md and up it becomes
          display:contents, vanishing from layout entirely so its three
          Widget children become direct DashboardGrid items in their own
          right (each carrying its own md/lg colSpan below). */}
      <div className="col-span-12 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:contents">
        <Widget
          title="GIR"
          colSpan={{ md: 4, lg: 2 }}
          className="min-w-[70%] shrink-0 snap-start md:min-w-0"
          status={statsStatus}
          errorMessage={isNetworkError ? networkErrorMessage : undefined}
          emptyState={<EmptyState title="No rounds yet" />}
        >
          {stats && <KpiStat label="GIR" value={percentLabel(stats.girPercentage)} />}
        </Widget>
        <Widget
          title="Sand"
          colSpan={{ md: 4, lg: 2 }}
          className="min-w-[70%] shrink-0 snap-start md:min-w-0"
          status={statsStatus}
          errorMessage={isNetworkError ? networkErrorMessage : undefined}
          emptyState={<EmptyState title="No rounds yet" />}
        >
          {/* "Sand interaction", not "sand shots" -- in_sand is a
              per-hole boolean, not a shot count (PlayerStats's own doc
              comment, ghs#101). */}
          {stats && <KpiStat label="Sand interaction" value={percentLabel(stats.sandInteractionPercentage)} />}
        </Widget>
        <Widget
          title="Penalties"
          colSpan={{ md: 4, lg: 2 }}
          className="min-w-[70%] shrink-0 snap-start md:min-w-0"
          status={statsStatus}
          errorMessage={isNetworkError ? networkErrorMessage : undefined}
          emptyState={<EmptyState title="No rounds yet" />}
        >
          {stats && <KpiStat label="Penalties" value={stats.penaltiesPerRound === null ? "--" : `${stats.penaltiesPerRound}/round`} />}
        </Widget>
      </div>
    </DashboardGrid>
  );
}
