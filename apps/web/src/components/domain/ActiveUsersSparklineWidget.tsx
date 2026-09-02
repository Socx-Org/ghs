import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { EmptyState } from "../EmptyState";
import { KpiStat } from "../KpiStat";
import { Skeleton } from "../Skeleton";
import { Widget } from "../Widget";
import type { WidgetColSpan } from "../Widget";
import type { ActiveUsersChartPeriod, ActiveUsersSeriesPoint } from "../../types/domain";

const PERIOD_LABELS: Record<ActiveUsersChartPeriod, string> = {
  "24h": "24h",
  week: "week",
  month: "month",
};

function formatBucketTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export interface ActiveUsersSparklineWidgetProps {
  colSpan?: WidgetColSpan;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: ReactNode;
  current?: number;
  period: ActiveUsersChartPeriod;
  series: ActiveUsersSeriesPoint[];
  previousSeries: ActiveUsersSeriesPoint[];
  hasHistory: boolean;
}

// ghs#195 (design reference: https://mosaic-nextjs-template.vercel.app/dashboard's
// own top-KPI sparklines): the live "active right now" number (unchanged
// from ghs#177/#180) plus a small, deliberately axis-less two-line
// sparkline -- current period bold/primary, previous period muted/gray,
// same overlapping-comparison pattern as that reference. Same CSS-
// custom-property theming technique as HandicapTrendWidget/
// UserTrendsWidget, just without XAxis/YAxis at all (the one deviation
// from those two: a sparkline reads as a shape, not a set of coordinates
// to look up).
//
// The live count always renders once loaded -- it doesn't depend on
// history existing. Only the chart itself is conditional on hasHistory:
// there's no way to backfill presence data that predates this feature
// shipping (ghs#195's own explicit, confirmed tradeoff), so a genuine
// cold start shows a plain "collecting history" note in the chart's
// place rather than a misleading flatlined-at-zero line.
export function ActiveUsersSparklineWidget({
  colSpan,
  isLoading,
  isError,
  errorMessage,
  current,
  period,
  series,
  previousSeries,
  hasHistory,
}: ActiveUsersSparklineWidgetProps) {
  const status = isLoading ? "loading" : isError ? "error" : current === undefined ? "empty" : "ready";
  const periodLabel = PERIOD_LABELS[period];

  const chartData = series.map((point, index) => ({
    index,
    current: point.count,
    previous: previousSeries[index]?.count ?? 0,
  }));

  return (
    <Widget
      title="Active right now"
      description="Active in the last 5 minutes"
      icon={Activity}
      colSpan={colSpan}
      status={status}
      errorMessage={errorMessage}
      emptyState={<EmptyState title="No one active" />}
      loadingSkeleton={<Skeleton height={140} />}
    >
      <div className="flex flex-col gap-3">
        <KpiStat label="Active right now" value={current} />

        {hasHistory ? (
          <>
            <div className="h-20 w-full" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                  <Tooltip
                    contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ display: "none" }}
                    itemStyle={{ color: "var(--color-text)" }}
                    formatter={(value, name) => [value, name === "current" ? `This ${periodLabel}` : `Previous ${periodLabel}`]}
                  />
                  <Line type="monotone" dataKey="previous" stroke="var(--color-text-muted)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="current" stroke="var(--color-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-muted" aria-hidden="true">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full bg-primary" /> This {periodLabel}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full bg-text-muted" /> Previous {periodLabel}
              </span>
            </div>
          </>
        ) : (
          <p className="text-xs text-text-muted">Collecting history for this chart -- it'll appear once the first snapshot is recorded, within 15 minutes.</p>
        )}
      </div>

      {/* Accessible alternative to the chart above, same reasoning and
          technique as HandicapTrendWidget/UserTrendsWidget's own sr-only
          tables. */}
      {hasHistory && (
        <table className="sr-only">
          <caption>
            Active users: this {periodLabel} compared with the previous {periodLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">This {periodLabel}</th>
              <th scope="col">Previous {periodLabel}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point, index) => (
              <tr key={point.timestamp}>
                <td>{formatBucketTimestamp(point.timestamp)}</td>
                <td>{point.count}</td>
                <td>{previousSeries[index]?.count ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Widget>
  );
}
