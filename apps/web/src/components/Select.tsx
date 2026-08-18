import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "block h-11 w-full rounded-md border bg-surface px-3 text-base text-text shadow-sm",
        "sm:text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
        "disabled:cursor-not-allowed disabled:bg-bg-page disabled:text-text-muted",
        invalid ? "border-danger bg-danger-surface" : "border-border-strong",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
