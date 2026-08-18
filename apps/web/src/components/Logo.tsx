import { cn } from "../lib/cn";

export type LogoVariant = "full" | "mark";

export interface LogoProps {
  variant?: LogoVariant;
  className?: string;
  /** Accessible label -- defaults to "SOCX", override for context (e.g. "GHS home"). */
  label?: string;
}

// Minimum rendered mark size is 24px -- below that the S stroke starts
// losing legibility. Circle/S colours come from the existing text/
// surface semantic tokens (not new logo-specific ones): circle =
// fill-text, S = fill-surface. In light theme that's exactly "white S
// in a near-black circle" as specified; in dark theme text/surface
// invert (slate-100 circle, slate-800 S) -- the same relationship,
// simple inversion, approved as the dark-theme treatment rather than
// introducing a third colour into the mark.
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-6 w-6 shrink-0", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="11" className="fill-text" />
      <path
        d="M 15 8
           C 15 6.3 13.5 5.5 12 5.5
           C 10.3 5.5 8.8 6.4 8.8 8
           C 8.8 10.8 15.3 10.3 15.3 14.1
           C 15.3 15.7 13.7 16.6 12 16.6
           C 10.2 16.6 8.8 15.6 8.8 14"
        fill="none"
        className="stroke-surface"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ variant = "full", className, label = "SOCX" }: LogoProps) {
  if (variant === "mark") {
    return (
      <span role="img" aria-label={label} className={cn("inline-flex", className)}>
        <Mark />
      </span>
    );
  }

  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-center", className)}>
      <Mark />
      {/* tracking-tight + font-semibold on the same system stack, not a
          second (webfont) typeface -- the "premium" character comes
          from weight/spacing restraint, not a different font family. */}
      <span aria-hidden="true" className="text-lg font-semibold tracking-tight text-text">
        ocx
      </span>
    </span>
  );
}
