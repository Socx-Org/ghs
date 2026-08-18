import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Generic presentation only -- no GHS domain knowledge here. The
// draft/pending/approved/rejected/amending and player/admin/super_admin
// mappings live in components/domain/ (RoundStatusBadge, RoleBadge), which
// consume this component rather than duplicate its styling.
export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info" | "amending";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  success: "bg-success-surface text-green-800 ring-green-200",
  warning: "bg-warning-surface text-amber-800 ring-amber-200",
  danger: "bg-danger-surface text-red-800 ring-red-200",
  info: "bg-info-surface text-blue-800 ring-blue-200",
  amending: "bg-amending-surface text-violet-800 ring-violet-200",
};

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
