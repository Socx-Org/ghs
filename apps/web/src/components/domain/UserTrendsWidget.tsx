import type { ReactNode } from "react";
import { TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../EmptyState";
import { Skeleton } from "../Skeleton";
import { ToggleGroup } from "../ToggleGroup";
import { Widget } from "../Widget";
import type { WidgetColSpan } from "../Widget";
import type { AdminDashboardPeriod } from "../../lib/api";
import type { RegistrationTrendPoint } from "../../types/domain";

const PERIOD_OPTIONS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

// Same bare-"YYYY-MM-DD"-parsed-as-local technique as HandicapTrendWidget's
// own formatDate (ghs#117) -- users.repository.ts's getRegistrationTrend
// returns a plain date string specifically to sidestep this class of bug
// (see that method's own doc comment), so the display side must parse it
// the same deliberate way rather than trusting `new Date(iso)`'s UTC-
// midnight interpretation.
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface UserTrendsWidgetProps {
  colSpan?: WidgetColSpan;
  period: AdminDashboardPeriod;
  onPeriodChange: (period: AdminDashboardPeriod) => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: ReactNode;
  data: RegistrationTrendPoint[];
}

// ghs#181 (design doc section C): daily-registrations bar chart, the
// first real use of recharts' BarChart in this app (the Handicap Trend
// Widget, ghs#117, uses its LineChart). Same CSS-custom-property
// theming technique as that widget -- recharts accepts a literal
// `var(--color-x)` for fill/stroke, so light/dark just works without
// any JS-side theme detection.
//
// The period selector lives in Widget's own `actions` header slot, not
// inside the chart body -- it renders regardless of status (Widget's
// own contract: actions stay available even while loading/erroring),
// so switching periods works even mid-load or after a failed request.
export function UserTrendsWidget({ colSpan, period, onPeriodChange, isLoading, isError, errorMessage, data }: UserTrendsWidgetProps) {
  const status = isLoading ? "loading" : isError ? "error" : data.length === 0 ? "empty" : "ready";

  const chartData = data.map((point) => ({
    date: point.date,
    label: formatDate(point.date),
    count: point.count,
  }));

  return (
    <Widget
      title="User trends"
      description="Daily registrations"
      icon={TrendingUp}
      colSpan={colSpan}
      status={status}
      errorMessage={errorMessage}
      emptyState={<EmptyState title="No registrations yet" description="New account registrations will show up here." />}
      loadingSkeleton={<Skeleton height={220} />}
      actions={
        <ToggleGroup
          name="user-trends-period"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(value) => onPeriodChange(value as AdminDashboardPeriod)}
        />
      }
    >
      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} />
            <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "var(--color-text)" }}
              itemStyle={{ color: "var(--color-text)" }}
              formatter={(value) => [value, "Registrations"]}
              cursor={{ fill: "var(--color-border)", opacity: 0.4 }}
            />
            <Bar dataKey="count" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Accessible alternative to the chart above, same reasoning and
          technique as HandicapTrendWidget's own sr-only table. */}
      <table className="sr-only">
        <caption>Daily registrations</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Registrations</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((point) => (
            <tr key={point.date}>
              <td>{formatDate(point.date)}</td>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Widget>
  );
}
