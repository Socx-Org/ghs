import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

// Review finding, PR #202: a plain { columnId: string | null; direction:
// SortDirection | null } interface lets both fields vary independently,
// so a value like { columnId: "name", direction: null } type-checks even
// though nothing in this hook (or SortableTableHeaderCell, which assumes
// "both set or both null") should ever produce or accept it. A
// discriminated union makes that combination genuinely unrepresentable,
// not just conventionally avoided.
export type SortState = { columnId: null; direction: null } | { columnId: string; direction: SortDirection };

const UNSORTED: SortState = { columnId: null, direction: null };

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
  const [rawSort, setRawSort] = useState<SortState>(UNSORTED);

  // Review finding, PR #202: if the current sort's column has no
  // matching accessor (e.g. a caller's accessors map is conditionally
  // built -- a column that was sortable stops being one, but this hook's
  // own state still remembers it), sortedItems below can't actually sort
  // by it and falls back to returning items unsorted. Reporting the RAW
  // state as `sort` in that case would tell the UI "this column is
  // sorted ascending" while the data it renders is plainly not -- so the
  // publicly returned `sort` is this "effective" state instead, always
  // consistent with what sortedItems actually reflects. toggleSort below
  // reads this same effective value, not the raw one, for the same
  // reason: from the caller's perspective there IS no active sort to
  // cycle away from once its accessor is gone.
  const sort: SortState = rawSort.columnId !== null && accessors[rawSort.columnId] ? rawSort : UNSORTED;

  const sortedItems = useMemo(() => {
    if (sort.columnId === null) return items;
    // sort is always consistent with a real accessor (see above) -- no
    // "accessor missing" fallback needed here.
    const getValue = accessors[sort.columnId]!;
    const direction = sort.direction;

    return [...items].sort((a, b) => {
      const aValue = getValue(a);
      const bValue = getValue(b);
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;

      // Review finding, PR #202: localeCompare's default collation is
      // case-SENSITIVE as a tertiary tie-break (only base letters are
      // compared case-insensitively) -- "apple" and "Apple" don't
      // collapse to equal, they resolve to a real, non-zero order.
      // Explicit sensitivity: "accent" makes case genuinely not matter
      // for ordering (while still distinguishing accented letters, e.g.
      // "e" vs "é" -- this app's real names/course names can be
      // international) -- not relying on collator defaults, which the
      // spec doesn't actually guarantee are case-insensitive at all.
      const comparison =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue), undefined, { sensitivity: "accent" });
      return direction === "desc" ? -comparison : comparison;
    });
    // Review finding, PR #202: accessors WAS omitted from these deps on
    // the theory that it's "just a perf optimization" to skip it -- that
    // was wrong. Omitting a value useMemo actually reads doesn't just
    // skip unnecessary recomputes, it can also skip NECESSARY ones: a
    // caller whose accessor closes over reactive state (locale, a
    // feature flag, a formatting preference) would get back a stale
    // sortedItems after that state changes, as long as items/sort
    // themselves happened not to change too. Since this hook is meant to
    // be genuinely reusable, correctness here matters more than the
    // recompute this accessors dependency costs -- and that cost is
    // cheap regardless (every table this hook sorts is a single already-
    // loaded, in-memory page of tens to low-hundreds of rows), which is
    // exactly why accepting "most callers pass a fresh object literal
    // every render, so this often recomputes anyway" is the right
    // trade-off rather than something to engineer around.
  }, [items, accessors, sort.columnId, sort.direction]);

  function toggleSort(columnId: string): void {
    // Review finding, PR #204: without this guard, toggling a columnId
    // with no accessor still wrote it into rawSort -- invisible right
    // now (the effective `sort` above already downgrades it to
    // UNSORTED), but a real latent bug: if that column's accessor is
    // added later (e.g. a feature flag turns a column on, or a caller's
    // accessors map is otherwise conditionally built), the hidden
    // rawSort would spring back to life and the table would suddenly
    // appear sorted by a column nobody clicked while it was actually
    // sortable. A no-op here means there's never a hidden state to
    // spring back from.
    if (!accessors[columnId]) return;
    if (sort.columnId !== columnId) {
      setRawSort({ columnId, direction: "asc" });
    } else if (sort.direction === "asc") {
      setRawSort({ columnId, direction: "desc" });
    } else {
      setRawSort(UNSORTED);
    }
  }

  return { sortedItems, sort, toggleSort };
}
