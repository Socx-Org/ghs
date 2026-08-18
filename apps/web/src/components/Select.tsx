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
        "block h-11 w-full rounded-md border bg-white px-3 text-base text-slate-900 shadow-sm",
        "sm:text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
        invalid ? "border-danger bg-danger-surface" : "border-slate-300",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
