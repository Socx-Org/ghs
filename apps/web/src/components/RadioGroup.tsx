import { cn } from "../lib/cn";

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function RadioGroup({ name, options, value, onChange, disabled, className }: RadioGroupProps) {
  return (
    <div role="radiogroup" className={cn("flex flex-col", className)}>
      {options.map((option) => {
        const isDisabled = disabled || option.disabled;
        return (
          // min-h-11 + py-2 on the label row, not the radio input itself
          // -- WCAG 2.5.5 allows the tappable *target* to include adjacent
          // label text, so the visual glyph stays a normal 20px size
          // instead of being forced to look like an oversized 44px dot.
          <label
            key={option.value}
            className={cn(
              "flex min-h-11 items-center gap-2 py-2 text-sm text-text",
              isDisabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={isDisabled}
              onChange={() => onChange?.(option.value)}
              className="h-5 w-5 border-border-strong text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
