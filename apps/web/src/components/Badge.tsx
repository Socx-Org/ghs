import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Generic presentation only -- no GHS domain knowledge here. The
// draft/pending/approved/rejected/amending and player/admin/super_admin
// mappings live in components/domain/ (RoundStatusBadge, RoleBadge), which
// consume this component rather than duplicate its styling.
export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info" | "amending";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "bg-border text-text-muted ring-border-strong",
  success: "bg-success-surface text-success ring-success-border",
  warning: "bg-warning-surface text-warning ring-warning-border",
  danger: "bg-danger-surface text-danger ring-danger-border",
  info: "bg-info-surface text-info ring-info-border",
  amending: "bg-amending-surface text-amending ring-amending-border",
};

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  /** Renders a small dismiss control -- no current GHS screen needs this
   *  yet, but it's cheap to support now for likely future filter chips. */
  onRemove?: () => void;
}

export function Badge({ variant = "neutral", children, className, onRemove }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          // hover:bg-text/10, not a fixed hover:bg-black/10 -- most badge
          // surfaces go very dark in dark theme, where a black overlay
          // barely reads as a hover affordance at all. text/10 is the
          // same overlay-tint pattern used elsewhere (Button's ghost
          // variant, Modal's close button) and adapts with the theme
          // (review finding, PR #83).
          className="-mr-1 rounded-full p-0.5 hover:bg-text/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </span>
  );
}
