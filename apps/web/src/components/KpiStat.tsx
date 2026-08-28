import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type KpiStatAccent = "success" | "warning" | "danger";

// Same literal-lookup-table technique as Badge's VARIANT_CLASSES and
// Avatar's SIZE_CLASSES -- these are the only three accents this
// component's contract allows, so there's nothing to interpolate.
const ACCENT_VALUE_CLASSES: Record<KpiStatAccent, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export interface KpiStatProps {
  label: string;
  value: ReactNode;
  secondary?: string;
  icon?: ReactNode;
  // Omitted = neutral. Design doc's own example: Pending Review uses
  // accent="warning" (amber), tied to the same semantic token every
  // pending-round badge elsewhere in the app already uses.
  accent?: KpiStatAccent;
  className?: string;
}

// ghs#175 (design doc section D): the simple-number content primitive for
// every KPI-shaped dashboard widget (Total Users, Total Courses, Total
// Rounds, Pending Review, Activity, GIR/Sand/Penalties, Active Right Now).
// A sibling of Stat (components/Stat.tsx), not a wrapper around it -- Stat
// is generic and theme-neutral by design and used outside the dashboard
// too (e.g. this catalogue's own plain Widget demo); `accent` is
// dashboard-specific semantic colouring that doesn't belong on Stat's
// general contract.
export function KpiStat({ label, value, secondary, icon, accent, className }: KpiStatProps) {
  return (
    <dl className={cn("flex flex-col gap-0.5", className)}>
      <dt className="flex items-center gap-1.5 text-sm text-text-muted">
        {icon && (
          <span aria-hidden="true" className="text-text-muted">
            {icon}
          </span>
        )}
        {label}
      </dt>
      <dd className={cn("text-2xl font-semibold tabular-nums", accent ? ACCENT_VALUE_CLASSES[accent] : "text-text")}>{value}</dd>
      {/* Review finding, PR #182: a <dl> may only contain dt/dd -- a
          second <dd> for the secondary line, not a <p>, same reasoning
          as SegmentedBar's own <dl> validity fix. */}
      {secondary && <dd className="text-xs text-text-muted">{secondary}</dd>}
    </dl>
  );
}
