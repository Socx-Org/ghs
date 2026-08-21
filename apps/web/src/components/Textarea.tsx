import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

// ghs#67: the app's first multi-line text input -- needed for a real
// rejection reason (a sentence or two, not a single line). Mirrors
// Input's own styling/invalid-state convention exactly, not a
// divergent pattern, just without the fixed h-11 (a textarea's height
// comes from `rows`, not a fixed single-line height).
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        "block w-full rounded-md border px-3 py-2 text-base text-text shadow-sm",
        "placeholder:text-text-muted sm:text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
        "disabled:cursor-not-allowed disabled:bg-bg-page disabled:text-text-muted",
        invalid ? "border-danger bg-danger-surface" : "border-border-strong bg-surface",
        className,
      )}
      {...rest}
    />
  );
});
