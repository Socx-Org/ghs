import { cloneElement, isValidElement, useId } from "react";
import type { ReactElement } from "react";
import { cn } from "../lib/cn";

interface ControllableProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  invalid?: boolean;
}

export interface FormFieldProps {
  label: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  children: ReactElement<ControllableProps>;
  className?: string;
}

// Composite label + control + help/error text, wiring htmlFor/id and
// aria-describedby automatically. Centralises the accessibility linkage
// that RMS's own frontend hand-wires per input per page (see
// apps/web/docs/frontend-architecture.md) -- a real, repeated correctness
// risk when done ad hoc, not premature abstraction.
export function FormField({ label, required = false, helpText, error, children, className }: FormFieldProps) {
  const generatedId = useId();
  const inputId = children.props.id ?? generatedId;
  // Same condition as the help-text render below (helpText && !error) --
  // otherwise aria-describedby can point at a help-text id that never
  // actually renders when both helpText and error are given (review
  // finding, PR #79).
  const helpId = helpText && !error ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: inputId,
        "aria-invalid": Boolean(error) || undefined,
        "aria-describedby": describedBy,
        invalid: Boolean(error),
      })
    : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>
      {control}
      {helpText && !error && (
        <p id={helpId} className="text-sm text-text-muted">
          {helpText}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
