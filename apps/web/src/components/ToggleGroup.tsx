import { cn } from "../lib/cn";

export interface ToggleOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ToggleGroupProps {
  name: string;
  options: ToggleOption[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

// Built on real <input type="radio"> elements (visually hidden, not
// hidden from assistive tech), styled via has-[:checked]: on the
// wrapping label -- not a custom div/button implementation. Same-name
// native radios already communicate "mutually exclusive group" to
// assistive tech and already support arrow-key navigation between
// options in every browser for free; reimplementing that in JS would
// be strictly worse and is exactly the kind of hand-rolled keyboard
// handling this project has already had to retrofit once (ListItem,
// ghs#78's review pass) rather than get right the first time.
export function ToggleGroup({ name, options, value, onChange, disabled, className }: ToggleGroupProps) {
  return (
    <div className={cn("inline-flex rounded-md border border-border bg-surface p-1", className)}>
      {options.map((option) => {
        const isDisabled = disabled || option.disabled;
        return (
          <label
            key={option.value}
            className={cn(
              "relative flex min-h-9 min-w-11 cursor-pointer items-center justify-center rounded px-3 text-sm font-medium text-text-muted transition-colors",
              "has-[:checked]:bg-primary has-[:checked]:text-text-on-primary",
              "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-primary",
              isDisabled ? "cursor-not-allowed opacity-50" : "hover:text-text",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={isDisabled}
              onChange={() => onChange?.(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
