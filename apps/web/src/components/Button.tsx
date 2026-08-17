import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
  destructive: "bg-danger text-white hover:bg-danger-hover",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
};

const SPINNER_CLASSES: Record<ButtonVariant, string> = {
  primary: "text-white",
  secondary: "text-slate-500",
  destructive: "text-white",
  ghost: "text-slate-500",
};

// md is the default and meets the 44px touch-target minimum. sm is
// intended for dense desktop-only contexts (e.g. inline table row
// actions) -- never the only way to reach a primary mobile action.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    isLoading = false,
    disabled,
    className,
    children,
    type = "button",
    "aria-label": ariaLabel,
    ...rest
  },
  ref,
) {
  const isIconOnly = !children && Boolean(ariaLabel);

  if (import.meta.env.DEV && !children && !ariaLabel) {
    console.error("Button: icon-only buttons require an aria-label so assistive tech has an accessible name.");
  }

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isIconOnly && "w-11 px-0",
        className,
      )}
      {...rest}
    >
      {isLoading && <Spinner size="sm" className={SPINNER_CLASSES[variant]} />}
      {children}
    </button>
  );
});
