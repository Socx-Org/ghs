import type { HTMLAttributes, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "../lib/cn";
import type { SortState } from "../lib/useTableSort";

// Wrapped in its own horizontal-scroll container by default -- a fixed
// table with many columns is unusable on a phone otherwise. Round history
// and admin queue views should prefer List at narrow widths and reserve
// Table for the data-dense desktop admin case (see frontend-architecture.md).
export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className={cn("min-w-full divide-y divide-border text-sm", className)} {...rest} />
    </div>
  );
}

export function TableHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-bg-page" {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y divide-border bg-surface" {...props} />;
}

export function TableRow(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

export function TableHeaderCell({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted", className)}
      {...rest}
    />
  );
}

export function TableCell({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 text-text", className)} {...rest} />;
}

export interface SortableTableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  // Matches whatever key the same column is registered under in the
  // SortAccessors map passed to useTableSort (lib/useTableSort.ts).
  columnId: string;
  sort: SortState;
  onSort: (columnId: string) => void;
}

// ghs#201: built on TableHeaderCell, not a parallel styled <th> -- same
// visual base as every other header cell, just with a real <button>
// (native keyboard/focus behaviour for free) wrapping the label and a
// direction icon. aria-sort lives on the <th> itself, per the ARIA
// table-sort convention -- not on the button, which merely triggers it.
export function SortableTableHeaderCell({ columnId, sort, onSort, className, children, ...rest }: SortableTableHeaderCellProps) {
  const direction = sort.columnId === columnId ? sort.direction : null;
  const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  const sortStateLabel = direction === "asc" ? "sorted ascending" : direction === "desc" ? "sorted descending" : "not sorted";

  return (
    // Review finding, PR #202: aria-sort must come AFTER {...rest}, not
    // before -- rest is typed to allow a caller-supplied aria-sort (it's
    // a plain ThHTMLAttributes prop), and this component's whole
    // contract is that aria-sort is computed from real sort state, never
    // caller-overridable, the same way `direction`/`Icon` above aren't
    // caller-settable props either.
    <TableHeaderCell className={className} {...rest} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(columnId)}
        className="inline-flex items-center gap-1 rounded text-inherit hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {children}{" "}
        <Icon aria-hidden="true" className={cn("h-3.5 w-3.5", direction === null && "opacity-40")} />
        {/* Review finding, PR #202: aria-sort on the <th> is the spec-
            correct place for it, but keyboard focus lands on this button
            -- many screen readers announce only the focused element's
            own accessible name, not an ancestor columnheader's
            aria-sort. Folded into the button's own name via sr-only text
            (not aria-describedby: a description is often lower-priority/
            optional in a screen reader's verbosity settings, while the
            accessible name is always announced), so the sort state is
            unambiguous regardless of how a given screen reader handles
            table-cell ancestry. The separating {" "} above must trail
            {"{children}"}, not lead this span -- accessible-name
            computation trims each contributing node's own leading/
            trailing whitespace before concatenating (confirmed
            directly: a leading space on this span's own text instead
            computes as "Namenot sorted", not "Name not sorted"). */}
        <span className="sr-only">{sortStateLabel}</span>
      </button>
    </TableHeaderCell>
  );
}
