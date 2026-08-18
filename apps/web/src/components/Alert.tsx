import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type AlertVariant = "success" | "error" | "warning" | "info";

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  success: "bg-success-surface text-success ring-success-border",
  error: "bg-danger-surface text-danger ring-danger-border",
  warning: "bg-warning-surface text-warning ring-warning-border",
  info: "bg-info-surface text-info ring-info-border",
};

// Announced textually as well as by colour, so the state doesn't rely on
// colour perception alone (WCAG 1.4.1).
const VARIANT_LABELS: Record<AlertVariant, string> = {
  success: "Success",
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export interface AlertProps {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Alert({ variant, title, children, className }: AlertProps) {
  const isUrgent = variant === "error" || variant === "warning";
  return (
    <div
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      className={cn("rounded-md px-4 py-3 text-sm ring-1 ring-inset", VARIANT_CLASSES[variant], className)}
    >
      <span className="sr-only">{VARIANT_LABELS[variant]}: </span>
      {title && <p className="font-medium">{title}</p>}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}
