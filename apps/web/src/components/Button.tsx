import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-text-on-primary hover:bg-primary-hover",
  secondary: "border border-border-strong bg-surface text-text hover:bg-bg-page",
  // text-on-primary, not a literal text-white -- measured: white text on
  // dark-mode danger's red-400 fill is 2.89:1 (fails AA badly); dark
  // (slate-900) text on red-400 is 6.17:1. Same "bright dark-mode
  // accent fill needs dark text, not white" pattern as primary, so this
  // reuses that token rather than adding a parallel text-on-danger one.
  destructive: "bg-danger text-text-on-primary hover:bg-danger-hover",
  // hover:bg-text/5 (a low-opacity overlay of the text colour), not a
  // solid semantic-background utility -- ghost buttons appear on both
  // page and card backgrounds, and a solid hover colour that happens to
  // match whichever one it's sitting on would be invisible. An overlay
  // tint is visible against either.
  ghost: "bg-transparent text-text hover:bg-text/5",
};

const SPINNER_CLASSES: Record<ButtonVariant, string> = {
  primary: "text-text-on-primary",
  secondary: "text-text-muted",
  destructive: "text-text-on-primary",
  ghost: "text-text-muted",
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
  // ghs#134: a leading icon, e.g.
  // `icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}`.
  // Deliberately not auto-sized/wrapped here: every other icon usage in
  // this app (Sidebar, AccountMenu, ThemeToggle) sizes its own icon via
  // className at the call site, not via a parent component forcing a
  // size -- this stays consistent with that rather than inventing a
  // second convention. Replaced by the loading spinner, not shown
  // alongside it, while isLoading is true.
  //
  // Icon-only buttons (no visible text, an `aria-label` instead) can be
  // built two ways, both valid: passing the icon as `children`
  // (ThemeToggle's pre-existing usage, predating this prop), or passing
  // it as `icon` with `children` omitted (every ListView row action --
  // Edit/Delete/Disable -- added after this prop existed uses this
  // form). Prefer the `icon`-prop form for new icon-only buttons: below,
  // `isIconOnly` checks only `children`, so only that form reliably gets
  // the square icon-button sizing regardless of whether an `icon` is
  // also passed.
  icon?: ReactNode;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    isLoading = false,
    icon,
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
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isIconOnly && "w-11 px-0",
        className,
      )}
      {...rest}
    >
      {isLoading ? <Spinner size="sm" className={SPINNER_CLASSES[variant]} /> : icon}
      {children}
    </button>
  );
});
