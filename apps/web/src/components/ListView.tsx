import type { ReactNode } from "react";
import { Table, TableBody, TableHead, TableRow } from "./Table";
import { ToggleGroup } from "./ToggleGroup";
import { useListView } from "../lib/useListView";
import type { ListViewMode } from "../lib/useListView";

export interface ListViewProps<T> {
  items: T[];
  getKey: (item: T) => string;
  // Scopes both the persisted view choice (localStorage) and the
  // ToggleGroup's radio `name` -- one real screen per id (e.g.
  // "accounts", "courses", "rounds"), so two ListViews on the page at
  // once (not expected today, but not precluded) wouldn't collide.
  id: string;
  defaultView?: ListViewMode;
  tableHead: ReactNode;
  renderTableRow: (item: T) => ReactNode;
  renderCard: (item: T) => ReactNode;
  emptyState?: ReactNode;
  className?: string;
}

// ghs#103: the standard list presentation (design doc section 7) --
// one items array, one shared data source, two representations. Any
// screen that browses many entities (Accounts, Courses, Rounds) should
// build on this rather than a bespoke table/grid split; a screen with a
// single small fixed dataset (e.g. round-entry's per-hole cards) isn't
// a browsable list in this sense and shouldn't reach for this.
//
// Grid view is plain semantic <ul>/<li> in a responsive CSS grid, not
// the existing List/ListItem primitives -- those render a single-column
// bordered, divided stack (the right shape for e.g. a settings list),
// which visually conflicts with a multi-column card grid. renderCard is
// expected to return a Card-based node; ListView itself stays
// unopinionated about what's inside each cell, same as renderTableRow.
export function ListView<T>({
  items,
  getKey,
  id,
  defaultView = "table",
  tableHead,
  renderTableRow,
  renderCard,
  emptyState,
  className,
}: ListViewProps<T>) {
  const [view, setView] = useListView(id, defaultView);

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-end gap-2">
        <span className="text-sm text-text-muted">View</span>
        <ToggleGroup
          name={`list-view-${id}`}
          value={view}
          onChange={(next) => setView(next as ListViewMode)}
          options={[
            { value: "table", label: "Table" },
            { value: "grid", label: "Grid" },
          ]}
        />
      </div>

      {items.length === 0 ? (
        emptyState
      ) : view === "table" ? (
        <Table>
          <TableHead>
            <TableRow>{tableHead}</TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={getKey(item)}>{renderTableRow(item)}</TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={getKey(item)}>{renderCard(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
