import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { Input } from "./Input";
import { Select } from "./Select";
import { Table, TableBody, TableHead, TableRow } from "./Table";
import { ToggleGroup } from "./ToggleGroup";
import { useListView } from "../lib/useListView";
import type { ListViewMode } from "../lib/useListView";

// ghs#137: an opt-in per-column filter (e.g. Role, Status) -- only
// screens with real enum-like columns provide these (CourseListPage
// provides none, since name/location are free text with no
// categorical values).
export interface ListViewFilter<T> {
  id: string;
  label: string;
  getValue: (item: T) => string;
  options: Array<{ value: string; label: string }>;
}

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
  // ghs#137: free-text search, filtering client-side against the full
  // items array already held in the browser. Opt-in -- a screen
  // designates its own searchable fields via getSearchText; omitting it
  // leaves the list exactly as it was before this issue.
  searchPlaceholder?: string;
  getSearchText?: (item: T) => string;
  filters?: Array<ListViewFilter<T>>;
}

// ghs#103: the standard list presentation (design doc section 16) --
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
  searchPlaceholder = "Search…",
  getSearchText,
  filters = [],
}: ListViewProps<T>) {
  const [view, setView] = useListView(id, defaultView);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const hasControls = Boolean(getSearchText) || filters.length > 0;

  // ghs#137: search narrows first, then each column filter narrows
  // further -- combining them is an AND, not an OR, matching how a user
  // reads "search for X, and also only show status Y" together.
  const filteredItems = useMemo(() => {
    let result = items;
    if (getSearchText && searchQuery.trim().length > 0) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((item) => getSearchText(item).toLowerCase().includes(query));
    }
    for (const filter of filters) {
      const value = filterValues[filter.id];
      if (value) {
        result = result.filter((item) => filter.getValue(item) === value);
      }
    }
    return result;
  }, [items, getSearchText, searchQuery, filters, filterValues]);

  // Distinct from the real emptyState (which describes a genuinely
  // empty dataset, e.g. "Courses added by an administrator will show up
  // here") -- that copy would be actively misleading if items exist but
  // a search/filter just narrowed them all out.
  const noMatches = items.length > 0 && filteredItems.length === 0;

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {hasControls ? (
          <div className="flex flex-wrap items-center gap-2">
            {getSearchText && (
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full sm:w-56"
              />
            )}
            {filters.map((filter) => (
              <Select
                key={filter.id}
                value={filterValues[filter.id] ?? ""}
                onChange={(event) => setFilterValues((prev) => ({ ...prev, [filter.id]: event.target.value }))}
                aria-label={filter.label}
                className="w-full sm:w-40"
              >
                <option value="">All {filter.label}</option>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ))}
          </div>
        ) : (
          // Keeps the View toggle pinned right even with no search/filter
          // controls on this screen (e.g. CourseListPage today).
          <div />
        )}

        <fieldset className="m-0 flex items-center gap-2 border-0 p-0">
          <legend className="text-sm text-text-muted">View</legend>
          <ToggleGroup
            name={`list-view-${id}`}
            value={view}
            onChange={(next) => {
              // Narrowed, not cast -- an options change that ever adds a
              // third value can't silently persist something outside
              // ListViewMode (review finding, PR #120).
              if (next === "table" || next === "grid") {
                setView(next);
              }
            }}
            options={[
              { value: "table", label: "Table" },
              { value: "grid", label: "Grid" },
            ]}
          />
        </fieldset>
      </div>

      {items.length === 0 ? (
        emptyState
      ) : noMatches ? (
        <EmptyState title="No matches" description="Try a different search term or filter." />
      ) : view === "table" ? (
        <Table>
          <TableHead>
            <TableRow>{tableHead}</TableRow>
          </TableHead>
          <TableBody>
            {filteredItems.map((item) => (
              <TableRow key={getKey(item)}>{renderTableRow(item)}</TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <li key={getKey(item)}>{renderCard(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
