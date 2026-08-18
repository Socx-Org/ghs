import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: string;
  className?: string;
}

// Self-contained <dl> per Stat (rather than requiring callers to wrap in
// their own <dl>) so composing several in a grid never produces invalid
// dt/dd-without-a-parent-dl markup regardless of layout.
export function Stat({ label, value, hint, className }: StatProps) {
  return (
    <dl className={cn("flex flex-col gap-0.5", className)}>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-2xl font-semibold text-slate-900">{value}</dd>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </dl>
  );
}
