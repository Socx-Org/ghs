import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, CircleDot, Plus, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, DashboardGrid, DonutStat, EmptyState, HandicapTrendWidget, KpiStat, RecentRoundsWidget, SegmentedBar, Widget } from "../components";
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

// ghs#209: how many rounds GIR/Fairways/Putting/Sand/Penalties are
// actually based on -- a real number once `stats` has loaded
// (statsWindowRoundsCount, which is <= the admin-configured window --
// smaller whenever the player has fewer approved rounds than it), a
// generic fallback beforehand (loading/error/empty/idle), since the
// exact count isn't known yet and showing a placeholder number would
// look like real data.
function statsWindowPhrase(stats: PlayerStats | undefined): string {
  if (!stats) return "your most recent approved rounds";
  return `your last ${stats.statsWindowRoundsCount} approved round${stats.statsWindowRoundsCount === 1 ? "" : "s"}`;
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
  // ghs#225: same reasoning as firStatus/puttingStatus above -- GIR/
  // Sand/Penalties became real 2-segment donuts this issue, and a donut
  // has no sensible way to render a null percentage (unlike KpiStat's
  // old plain-text "--"), so each needs its own empty check on top of
  // statsStatus, not just the generic "any approved rounds at all"
  // check. In practice girPercentage/sandInteractionPercentage/
  // penaltyFreeHolesPercentage are only null when holesCount is 0 --
  // since every approved round has real hole_scores by the time it's
  // approved, that's only ever possible for a brand-new player, a case
  // statsStatus's own "empty" branch already catches. These three exist
  // for defensive correctness, not a reachable-today gap.
  const girStatus: SectionStatus = statsStatus === "ready" && stats?.girPercentage === null ? "empty" : statsStatus;
  const sandStatus: SectionStatus = statsStatus === "ready" && stats?.sandInteractionPercentage === null ? "empty" : statsStatus;
  const penaltiesStatus: SectionStatus = statsStatus === "ready" && stats?.penaltyFreeHolesPercentage === null ? "empty" : statsStatus;

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
        infoTooltip="Your total approved rounds and the number of distinct courses you've played."
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
        infoTooltip={`Across ${statsWindowPhrase(stats)}: the share of fairway holes hit, and the split between missing left and missing right.`}
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

      {/* ghs#227: Putting/GIR/Sand/Penalties are flat siblings, each
          carrying the SAME colSpan -- CSS grid's own auto-flow packs
          them 1-per-row (base, 12/12 each), 2-per-row (md, 6/12 each,
          two rows of two), 4-per-row (lg, 3/12 each, one row), with no
          wrapper markup needed at all. Replaces the previous special-
          cased mobile "horizontal swipe strip" wrapper (ghs#178's
          design-doc-cited pattern) entirely -- resolved with the user
          (ghs#227) in favour of plain stacking, same as every other
          widget on this page, once Putting joined this group. */}
      <Widget
        title="Putting"
        icon={CircleDot}
        colSpan={{ base: 12, md: 6, lg: 3 }}
        status={puttingStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No putting data yet" description="Approved rounds with recorded putts will show up here." />}
        infoTooltip={`Your average putts per round, and the split between 1-putt, 2-putt, and 3+ putt holes, across ${statsWindowPhrase(stats)}.`}
      >
        {/* ghs#227: DonutStat's centerLabel is caller-supplied, not
            auto-derived from one "favourable" segment -- there's no
            single percentage that represents a 3-way split the way
            GIR/Sand/Penalties' 2-way splits each have one. The existing
            puttsPerRound average fills that role instead, same as it
            did as SegmentedBar's own headline; "putts/round" moves to
            the caption slot (Penalties' own existing convention). */}
        {stats && (
          <DonutStat
            centerLabel={stats.puttsPerRound === null ? "--" : stats.puttsPerRound}
            caption="putts/round"
            segments={[
              { label: "1-putt", value: (stats.onePuttHoles / stats.puttsHolesCount) * 100, colorClass: "bg-success" },
              { label: "2-putt", value: (twoPuttHoles(stats) / stats.puttsHolesCount) * 100, colorClass: "bg-primary" },
              { label: "3+ putt", value: (stats.threePlusPuttHoles / stats.puttsHolesCount) * 100, colorClass: "bg-warning" },
            ]}
          />
        )}
      </Widget>
      <Widget
        title="GIR"
        colSpan={{ base: 12, md: 6, lg: 3 }}
        status={girStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No GIR data yet" description="Approved rounds will show up here." />}
        infoTooltip={`The share of holes hit in regulation, across ${statsWindowPhrase(stats)}.`}
      >
        {stats && (
          <DonutStat
            centerLabel={percentLabel(stats.girPercentage)}
            segments={[
              { label: "Hit", value: stats.girPercentage ?? 0, colorClass: "bg-success" },
              { label: "Missed", value: 100 - (stats.girPercentage ?? 0), colorClass: "bg-warning" },
            ]}
          />
        )}
      </Widget>
      <Widget
        title="Sand"
        colSpan={{ base: 12, md: 6, lg: 3 }}
        status={sandStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No sand data yet" description="Approved rounds will show up here." />}
        infoTooltip={`The share of holes with a sand interaction (e.g. a bunker shot), across ${statsWindowPhrase(stats)}.`}
      >
        {/* "Sand interaction", not "sand shots" -- in_sand is a
            per-hole boolean, not a shot count (PlayerStats's own doc
            comment, ghs#101). The donut's favourable (green) segment
            is "No interaction", not "Interaction" -- deliberately
            100 - sandInteractionPercentage, not the raw field itself. */}
        {stats && (
          <DonutStat
            centerLabel={percentLabel(100 - (stats.sandInteractionPercentage ?? 0))}
            segments={[
              { label: "No interaction", value: 100 - (stats.sandInteractionPercentage ?? 0), colorClass: "bg-success" },
              { label: "Sand interaction", value: stats.sandInteractionPercentage ?? 0, colorClass: "bg-warning" },
            ]}
          />
        )}
      </Widget>
      <Widget
        title="Penalties"
        colSpan={{ base: 12, md: 6, lg: 3 }}
        status={penaltiesStatus}
        errorMessage={isNetworkError ? networkErrorMessage : undefined}
        emptyState={<EmptyState title="No penalty data yet" description="Approved rounds will show up here." />}
        infoTooltip={`The share of holes with zero penalty strokes, and your average penalty strokes per round, across ${statsWindowPhrase(stats)}.`}
      >
        {stats && (
          <DonutStat
            centerLabel={percentLabel(stats.penaltyFreeHolesPercentage)}
            caption={stats.penaltiesPerRound === null ? undefined : `${stats.penaltiesPerRound}/round`}
            segments={[
              { label: "Penalty-free", value: stats.penaltyFreeHolesPercentage ?? 0, colorClass: "bg-success" },
              { label: "Penalty", value: 100 - (stats.penaltyFreeHolesPercentage ?? 0), colorClass: "bg-warning" },
            ]}
          />
        )}
      </Widget>
    </DashboardGrid>
  );
}
