import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  columnId: string | null;
  direction: SortDirection | null;
}

// One accessor per sortable column, keyed by the same columnId a caller
// passes to SortableTableHeaderCell -- deliberately decoupled from
// whatever a column actually displays (ghs#201: every real table in this
// app mixes direct fields with computed/derived display values -- a
// joined name, a formatted date, a fallback-substituted location string
// -- so sorting needs its own explicit "real, comparable value" per
// column, e.g. the raw ISO createdAt string powering a "Created" column
// whose cell renders a locale-formatted date).
export type SortAccessors<T> = Record<string, (item: T) => string | number | null>;

// ghs#201: a standalone hook, not a ListView feature -- works identically
// for a ListView-backed table and a bare <Table> (e.g. DailyPccPage),
// and needs zero changes to ListView's own prop shape. A caller sorts
// its own items with this before handing them to whatever renders the
// rows.
//
// Click cycle: unsorted -> ascending -> descending -> unsorted; clicking
// a different column always resets to ascending on the new column, never
// carries over the previous column's direction.
//
// Nulls always sort last, regardless of direction -- a column with
// missing data (e.g. no handicap index yet) reads as "nothing to rank"
// rather than jumping to the top on a descending sort.
export function useTableSort<T>(items: T[], accessors: SortAccessors<T>) {
  const [sort, setSort] = useState<SortState>({ columnId: null, direction: null });

  const sortedItems = useMemo(() => {
    if (!sort.columnId || !sort.direction) return items;
    const getValue = accessors[sort.columnId];
    if (!getValue) return items;

    const direction = sort.direction;
    return [...items].sort((a, b) => {
      const aValue = getValue(a);
      const bValue = getValue(b);
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;

      const comparison = typeof aValue === "number" && typeof bValue === "number" ? aValue - bValue : String(aValue).localeCompare(String(bValue));
      return direction === "desc" ? -comparison : comparison;
    });
    // accessors is a plain object literal at nearly every call site (not
    // memoized) -- deliberately not a dependency here. Every table this
    // hook sorts is a single already-loaded, in-memory page of data (tens
    // to low hundreds of rows), so recomputing on every render this
    // hook's caller re-renders for any reason is cheap enough that
    // requiring callers to useMemo/useCallback their own accessor map
    // would be defensive complexity with no real payoff -- same "small
    // in-memory list, don't over-engineer it" posture ListView's own
    // filterKey/pagination logic already takes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort.columnId, sort.direction]);

  function toggleSort(columnId: string): void {
    setSort((previous) => {
      if (previous.columnId !== columnId) return { columnId, direction: "asc" };
      if (previous.direction === "asc") return { columnId, direction: "desc" };
      return { columnId: null, direction: null };
    });
  }

  return { sortedItems, sort, toggleSort };
}
