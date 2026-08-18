import { cn } from "../lib/cn";

export type SpinnerSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
};

export interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}

export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span
      role="status"
      className={cn(
        "inline-block animate-spin rounded-full border-current border-t-transparent",
        SIZE_CLASSES[size],
        className,
      )}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
