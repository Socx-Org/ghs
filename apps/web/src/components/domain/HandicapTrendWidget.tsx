import type { ReactNode } from "react";
import { TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../EmptyState";
import { Skeleton } from "../Skeleton";
import { Widget } from "../Widget";
import type { HandicapHistoryRecord } from "../../types/domain";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface HandicapTrendWidgetProps {
  // Same reasoning as RecentRoundsWidget's own isIdle (ghs#116 review
  // fix, PR #173): a prerequisite the caller depends on (e.g.
  // PlayerDashboardPage's own player profile) failed to load, already
  // surfaced elsewhere on the page -- not this widget's own loading/
  // error/empty condition to report, and NOT perpetual loading either
  // (a disabled query never resolves out of "pending" on its own).
  isIdle?: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: ReactNode;
  // Any order -- the backend's own listForPlayer returns newest-first
  // (calculation_date DESC); this widget sorts to oldest-first itself,
  // the order a trend line needs, so callers never have to remember to.
  history: HandicapHistoryRecord[];
}

// ghs#117 (design doc section 9.2): a responsive line chart of handicap
// index over time, built on the Widget primitive (#116). Themed via the
// same CSS custom properties (--color-*, styles/theme.css) every other
// component already reads through Tailwind, rather than a hardcoded
// palette or JS-side theme detection -- recharts elements accept a
// literal `var(--color-x)` string for stroke/fill, so light/dark just
// works the same way it already does everywhere else in this app.
//
// A single data point can't show a real trend -- design doc's own
// instruction not to render a misleading single-point "line". Fewer
// than 2 history rows is treated as Widget's "empty" status, with
// messaging that distinguishes "no index established yet" (matches
// PlayerDashboardPage's own existing empty-state wording for the same
// underlying WHS eligibility rule) from "only one change so far."
export function HandicapTrendWidget({ isIdle, isLoading, isError, errorMessage, history }: HandicapTrendWidgetProps) {
  const sorted = [...history].sort((a, b) => a.calculationDate.localeCompare(b.calculationDate));
  const status = isIdle ? "idle" : isLoading ? "loading" : isError ? "error" : sorted.length < 2 ? "empty" : "ready";
  const latest = sorted.at(-1);
  const first = sorted[0];

  const chartData = sorted.map((record) => ({
    calculationDate: record.calculationDate,
    label: formatDate(record.calculationDate),
    handicapIndex: record.handicapIndex,
  }));

  return (
    <Widget
      title="Handicap trend"
      icon={TrendingUp}
      status={status}
      errorMessage={errorMessage}
      secondaryMetric={latest ? `Current ${latest.handicapIndex.toFixed(1)}` : undefined}
      emptyState={
        sorted.length === 0 ? (
          <EmptyState title="Not yet established" description="Submit at least 3 rounds (54 holes) to get your first handicap index." />
        ) : (
          <EmptyState
            title="Not enough history yet"
            description="Your handicap index has changed once so far -- a trend will appear once it's changed again."
          />
        )
      }
      loadingSkeleton={<Skeleton height={220} />}
    >
      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} />
            <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} width={32} />
            <Tooltip
              contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "var(--color-text)" }}
              itemStyle={{ color: "var(--color-text)" }}
              formatter={(value) => [typeof value === "number" ? value.toFixed(1) : value, "Handicap Index"]}
            />
            <Line type="monotone" dataKey="handicapIndex" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Accessible alternative to the chart above (aria-hidden, design
          doc's own "accessible labels/alternative information"
          requirement) -- a real data table, not just a caption, so a
          screen-reader user gets the same information a sighted user
          reads off the chart, not merely "there is a chart here". */}
      {first && latest && (
        <p className="sr-only">
          Handicap index trend from {first.handicapIndex.toFixed(1)} on {formatDate(first.calculationDate)} to {latest.handicapIndex.toFixed(1)} on{" "}
          {formatDate(latest.calculationDate)}, across {sorted.length} changes.
        </p>
      )}
      <table className="sr-only">
        <caption>Handicap index history</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Handicap Index</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((record) => (
            <tr key={record.id}>
              <td>{formatDate(record.calculationDate)}</td>
              <td>{record.handicapIndex.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Widget>
  );
}
