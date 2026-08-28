import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SegmentedBarSegment {
  label: string;
  // A percentage (0-100). Segments are rendered in the array's own
  // order -- this component never reorders them, since the order itself
  // is meaningful (e.g. FIR's missed-left/hit/missed-right maps onto
  // real shot direction; an alphabetised or value-sorted bar would lose
  // that, the same reasoning the design doc gives for choosing this over
  // a donut).
  value: number;
  // A literal Tailwind background class (e.g. "bg-danger", "bg-primary"),
  // supplied whole by the caller -- never constructed here from a
  // variable, so Tailwind's static class scan always sees it.
  colorClass: string;
}

export interface SegmentedBarProps {
  headline: ReactNode;
  headlineLabel?: string;
  segments: SegmentedBarSegment[];
  className?: string;
}

// ghs#175 (design doc section D/L): the spatially-ordered content
// primitive for FIR (missed-left/hit/missed-right) and Putting
// (1-putt/2-putt/3+-putt), deliberately not a donut -- a donut's
// clockwise segment order carries no real-world meaning for either
// metric, where this bar's left-to-right order does.
//
// The coloured bar itself is aria-hidden (decorative, like
// HandicapTrendWidget's chart) -- the <dl> legend beneath it is the real
// accessible content, giving a screen-reader user the same label+value
// pairs a sighted user reads off the bar, not just "there is a bar here".
export function SegmentedBar({ headline, headlineLabel, segments, className }: SegmentedBarProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        {headlineLabel && <p className="text-sm text-text-muted">{headlineLabel}</p>}
        <p className="text-2xl font-semibold tabular-nums text-text">{headline}</p>
      </div>

      <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full bg-border">
        {segments.map((segment) => (
          <div key={segment.label} className={segment.colorClass} style={{ width: `${segment.value}%` }} />
        ))}
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", segment.colorClass)} />
            <dt className="text-text-muted">{segment.label}</dt>
            <dd className="font-medium tabular-nums text-text">{Math.round(segment.value)}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
