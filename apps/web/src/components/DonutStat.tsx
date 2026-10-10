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

export interface DonutStatProps {
  // The favourable/primary segment's percentage (0-100) -- the
  // secondary segment is always 100 - value, so callers can never pass
  // two numbers that disagree with each other.
  value: number;
  primaryLabel: string;
  secondaryLabel: string;
  // ghs#225: Penalties keeps its existing "X strokes/round" average
  // alongside the new donut -- the one number this widget already had,
  // and a dimension (an average, not a holes-based split) the donut
  // itself can't show.
  caption?: string;
  className?: string;
}

const PRIMARY_COLOR = "var(--color-success)";
const SECONDARY_COLOR = "var(--color-warning)";

// ghs#225: the 2-segment donut primitive for GIR/Sand/Penalties --
// a sibling of SegmentedBar, not a variant of it. SegmentedBar's own
// doc comment explains why FIR/Putting are deliberately NOT donuts
// (their segments have real spatial/ordered meaning a donut's clockwise
// order would obscure); GIR/Sand/Penalties have no such ordering -- each
// is a plain hit/miss, present/absent split, where a donut is the
// idiomatic chart instead.
//
// The donut itself is aria-hidden (decorative, same convention as
// HandicapTrendWidget's chart and SegmentedBar's coloured bar) -- the
// <dl> legend beside it is the real accessible content, giving a
// screen-reader user the same label+value pairs a sighted user reads
// off the chart, not just "there is a chart here."
export function DonutStat({ value, primaryLabel, secondaryLabel, caption, className }: DonutStatProps) {
  const primary = clampPercent(value);
  const secondary = 100 - primary;
  const data = [
    { name: primaryLabel, value: primary },
    { name: secondaryLabel, value: secondary },
  ];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div aria-hidden="true" className="relative h-20 w-20 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          {/* startAngle=90/endAngle=-270: recharts' own default (0 ->
              360, counter-clockwise from 3 o'clock) would start the
              primary segment at the donut's right edge -- this instead
              starts it at 12 o'clock, going clockwise, the conventional
              orientation a donut/pie reader expects. */}
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
              <Cell fill={PRIMARY_COLOR} />
              <Cell fill={SECONDARY_COLOR} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-text">{Math.round(primary)}%</div>
      </div>

      <dl className="flex flex-col gap-1 text-xs">
        <div className="flex items-center gap-1.5">
          <dt className="flex items-center gap-1.5 text-text-muted">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success" />
            {primaryLabel}
          </dt>
          <dd className="font-medium tabular-nums text-text">{Math.round(primary)}%</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="flex items-center gap-1.5 text-text-muted">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warning" />
            {secondaryLabel}
          </dt>
          <dd className="font-medium tabular-nums text-text">{Math.round(secondary)}%</dd>
        </div>
        {caption && <p className="text-text-muted">{caption}</p>}
      </dl>
    </div>
  );
}
