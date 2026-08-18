import { cn } from "../lib/cn";

export type ToastVariant = "success" | "error" | "warning" | "info";

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "bg-success-surface text-success border-success-border",
  error: "bg-danger-surface text-danger border-danger-border",
  warning: "bg-warning-surface text-warning border-warning-border",
  info: "bg-info-surface text-info border-info-border",
};

const VARIANT_LABELS: Record<ToastVariant, string> = {
  success: "Success",
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export interface ToastProps {
  variant: ToastVariant;
  title?: string;
  message: string;
  onDismiss: () => void;
}

// Same role split as Alert (error/warning = alert/assertive, success/info
// = status/polite) -- individually-roled elements are implicit live
// regions on mount, so no wrapping aria-live container is needed on top
// (that would risk double-announcing in some screen readers).
export function Toast({ variant, title, message, onDismiss }: ToastProps) {
  const isUrgent = variant === "error" || variant === "warning";
  return (
    <div
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      className={cn(
        "flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg",
        VARIANT_CLASSES[variant],
      )}
    >
      <div className="flex-1">
        <span className="sr-only">{VARIANT_LABELS[variant]}: </span>
        {title && <p className="font-medium">{title}</p>}
        <p className={title ? "mt-1" : undefined}>{message}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  );
}
