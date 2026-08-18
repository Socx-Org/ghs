import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

// Self-contained <dl> per Stat (rather than requiring callers to wrap in
// their own <dl>) so composing several in a grid never produces invalid
// dt/dd-without-a-parent-dl markup regardless of layout. tabular-nums on
// the value -- a handicap-index/scoring app where digits routinely sit
// in aligned columns benefits from monospaced-width digits, a small,
// disciplined touch rather than decoration.
export function Stat({ label, value, hint, icon, className }: StatProps) {
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
      <dd className="text-2xl font-semibold tabular-nums text-text">{value}</dd>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </dl>
  );
}
