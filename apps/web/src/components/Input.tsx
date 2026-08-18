import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "block h-11 w-full rounded-md border px-3 text-base text-text shadow-sm",
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
