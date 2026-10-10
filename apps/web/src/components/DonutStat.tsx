import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { cn } from "../lib/cn";

// Same defensive clamp as SegmentedBar's own clampPercent -- a plain
// caller-supplied number with no runtime guarantee it's really 0-100;
// NaN/Infinity must not survive into the Pie's data (recharts would
// otherwise render a degenerate or invisible arc).
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export interface DonutStatSegment {
  label: string;
  // A percentage (0-100) -- same convention as SegmentedBar's own
  // segment.value (clamped here, not trusted from the caller).
  value: number;
  // A literal Tailwind background class (e.g. "bg-success"), same
  // convention as SegmentedBar's own colorClass -- supplied whole by
  // the caller, never constructed from a variable, so Tailwind's static
  // class scan always sees it. Used for the legend swatch; recharts'
  // own Pie/Cell needs a real paintable SVG colour instead of a class,
  // which FILL_BY_COLOR_CLASS below resolves it to.
  colorClass: string;
}

export interface DonutStatProps {
  // ghs#227: generalized from a fixed 2-segment (favourable/
  // unfavourable) shape to an arbitrary-length array -- the same shape
  // SegmentedBar's own `segments` prop already uses -- so Putting's
  // existing 3-category split (1-putt/2-putt/3+-putt) can render here
  // too, not just GIR/Sand/Penalties' 2-category ones.
  segments: DonutStatSegment[];
  // ghs#227: caller-supplied, not auto-derived -- there's no single
  // "the" percentage to show for an arbitrary N-segment split (Putting
  // has no one favourable segment the way GIR/Sand/Penalties each do).
  // GIR/Sand/Penalties pass their own rounded percentage; Putting
  // passes its existing puttsPerRound average instead.
  centerLabel: ReactNode;
  // ghs#225: Penalties' existing "X strokes/round" average, ghs#227:
  // also Putting's existing "X putts/round" -- a dimension (an average,
  // not a holes-based split) the donut itself can't show.
  caption?: ReactNode;
  className?: string;
}

// ghs#227: the small set of semantic colour tokens this app's charts
// actually use as a colorClass -- extend this table, not a second,
// parallel colour prop, if a future donut needs another token.
const FILL_BY_COLOR_CLASS: Record<string, string> = {
  "bg-success": "var(--color-success)",
  "bg-primary": "var(--color-primary)",
  "bg-warning": "var(--color-warning)",
  "bg-danger": "var(--color-danger)",
};

// ghs#225: the N-segment donut primitive for GIR/Sand/Penalties/Putting
// -- a sibling of SegmentedBar, not a variant of it. SegmentedBar's own
// doc comment explains why FIR is deliberately NOT a donut (its
// segments have real spatial/ordered meaning a donut's clockwise order
// would obscure); GIR/Sand/Penalties/Putting don't have that problem --
// each is a plain categorical split (hit/miss, present/absent, or
// putts-per-hole buckets), where a donut is the idiomatic chart.
//
// The donut itself is aria-hidden (decorative, same convention as
// HandicapTrendWidget's chart and SegmentedBar's coloured bar) -- the
// <dl> legend beside it is the real accessible content, giving a
// screen-reader user the same label+value pairs a sighted user reads
// off the chart, not just "there is a chart here."
export function DonutStat({ segments, centerLabel, caption, className }: DonutStatProps) {
  const data = segments.map((segment) => ({ name: segment.label, value: clampPercent(segment.value) }));

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div aria-hidden="true" className="relative h-20 w-20 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          {/* startAngle=90/endAngle=-270: recharts' own default (0 ->
              360, counter-clockwise from 3 o'clock) would start the
              first segment at the donut's right edge -- this instead
              starts it at 12 o'clock, going clockwise, the conventional
              orientation a donut/pie reader expects. */}
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
              {segments.map((segment, index) => (
                <Cell key={`${segment.label}-${index}`} fill={FILL_BY_COLOR_CLASS[segment.colorClass] ?? "var(--color-border)"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-text">{centerLabel}</div>
      </div>

      <div className="flex flex-col gap-1 text-xs">
        {/* Review finding, PR #226: a <dl> in "div mode" (each group
            wrapped in its own <div>, as below -- needed so duplicate
            labels still get distinct React keys, same reasoning as
            SegmentedBar's own PR #182 review fix) may ONLY contain
            <div>s -- the caption can't be a trailing <dd>/<p> inside
            it. Caption sits outside the <dl> entirely instead. */}
        <dl>
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
        {caption && <p className="text-text-muted">{caption}</p>}
      </div>
    </div>
  );
}
