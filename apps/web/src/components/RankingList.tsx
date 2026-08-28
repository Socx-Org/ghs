import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import { cn } from "../lib/cn";

// Review finding (PR #182, Copilot): item.share is a plain caller-
// supplied number with no runtime guarantee it's actually 0-100 -- bad
// data or a rounding error upstream would otherwise render a negative
// or overflowing bar. Clamped here rather than trusting every caller.
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export interface RankingListItem {
  id: string;
  label: string;
  secondary?: string;
  // Present only for entries that represent a person (e.g. Most Active
  // Players) -- omitted for Top Courses, which has no avatar at all.
  avatarName?: string;
  value: ReactNode;
  // A percentage (0-100) of the list's own top value, driving the
  // proportional bar -- not a percentage of the metric's own domain
  // (e.g. Top Courses' bars are relative to the top course's round
  // count, not "% of all rounds", which callers rarely have handy and
  // which would make the leader's own bar rarely reach full width).
  share: number;
}

export interface RankingListProps {
  items: RankingListItem[];
  className?: string;
}

// ghs#175 (design doc section D): the rank+label+value content primitive
// for Top Courses and Most Active Players. Renders as a real <ol> --
// list order is the content's own meaning here (rank), not merely
// visual sequencing.
export function RankingList({ items, className }: RankingListProps) {
  return (
    <ol className={cn("flex flex-col gap-3", className)}>
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center gap-3">
          <span className="w-4 shrink-0 text-right text-sm font-medium tabular-nums text-text-muted">{index + 1}</span>
          {item.avatarName && <Avatar name={item.avatarName} size="sm" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-text">{item.label}</p>
              <span className="shrink-0 text-sm tabular-nums text-text-muted">{item.value}</span>
            </div>
            {item.secondary && <p className="truncate text-xs text-text-muted">{item.secondary}</p>}
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary" style={{ width: `${clampPercent(item.share)}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
