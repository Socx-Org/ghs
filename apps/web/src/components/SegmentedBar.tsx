import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Review finding, PR #182: segment.value is a plain caller-supplied
// number with no runtime guarantee it's actually 0-100 -- a rounding
// error or bad data upstream would otherwise render a negative or
// overflowing bar segment/width. Clamped once, here, rather than
// trusting every caller to clamp its own inputs. NaN/Infinity would
// otherwise survive Math.min/Math.max and produce a literal "width:
// NaN%"/"width: Infinity%" -- treated as 0 rather than propagated.
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

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

      {/* Review finding, PR #182: segment.label alone isn't guaranteed
          unique (nothing stops a caller passing two segments with the
          same label), so it's not a safe React key on its own --
          label+index below is. */}
      <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full bg-border">
        {segments.map((segment, index) => (
          <div key={`${segment.label}-${index}`} className={segment.colorClass} style={{ width: `${clampPercent(segment.value)}%` }} />
        ))}
      </div>

      {/* Review finding, PR #182: a <dl> may only contain dt/dd
          (optionally grouped in a <div> containing dt/dd, optionally
          intermixed with script-supporting elements) -- the colour swatch
          <span> belongs inside <dt>, not as a sibling of it, or the
          markup is invalid. */}
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((segment, index) => (
          <div key={`${segment.label}-${index}`} className="flex items-center gap-1.5">
            <dt className="flex items-center gap-1.5 text-text-muted">
              <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", segment.colorClass)} />
              {segment.label}
            </dt>
            <dd className="font-medium tabular-nums text-text">{Math.round(clampPercent(segment.value))}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
