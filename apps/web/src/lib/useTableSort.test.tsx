import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTableSort } from "./useTableSort";
import type { SortAccessors } from "./useTableSort";

interface Row {
  id: string;
  name: string;
  score: number | null;
}

const ROWS: Row[] = [
  { id: "1", name: "Charlie", score: 20 },
  { id: "2", name: "alice", score: null },
  { id: "3", name: "Bob", score: 10 },
];

const ACCESSORS = {
  name: (row: Row) => row.name,
  score: (row: Row) => row.score,
};

describe("useTableSort", () => {
  it("returns items in their original order when nothing is sorted yet", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    expect(result.current.sortedItems).toEqual(ROWS);
    expect(result.current.sort).toEqual({ columnId: null, direction: null });
  });

  it("first click sorts ascending by the string accessor (localeCompare)", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    act(() => result.current.toggleSort("name"));
    expect(result.current.sort).toEqual({ columnId: "name", direction: "asc" });
    expect(result.current.sortedItems.map((r) => r.name)).toEqual(["alice", "Bob", "Charlie"]);
  });

  it("treats two names differing only by case as equal, not ordered by case (review finding, PR #202: the previous version of this file asserted 'case-insensitively' without any data that could actually distinguish it from case-sensitive collation)", () => {
    // Bob/bob is the minimal real proof: localeCompare's own DEFAULT
    // collation is not case-insensitive -- "Bob".localeCompare("bob")
    // is a real, non-zero -1/1 (confirmed directly), not a tie. With
    // sensitivity: "accent" it's a genuine tie (0), so Array.prototype
    // .sort's guaranteed stability (ES2019+) preserves the original
    // "Bob" (id 1) before "bob" (id 2) order. Under the old, unfixed
    // default collation this would instead come out reversed.
    const rows: Row[] = [
      { id: "1", name: "Bob", score: 1 },
      { id: "2", name: "bob", score: 2 },
    ];
    const { result } = renderHook(() => useTableSort(rows, ACCESSORS));
    act(() => result.current.toggleSort("name"));
    expect(result.current.sortedItems.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("second click on the same column flips to descending", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name"));
    expect(result.current.sort).toEqual({ columnId: "name", direction: "desc" });
    expect(result.current.sortedItems.map((r) => r.name)).toEqual(["Charlie", "Bob", "alice"]);
  });

  it("third click on the same column resets to unsorted (original order)", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name"));
    expect(result.current.sort).toEqual({ columnId: null, direction: null });
    expect(result.current.sortedItems).toEqual(ROWS);
  });

  it("clicking a different column always starts at ascending, never carrying over the previous column's direction", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name")); // name: desc
    act(() => result.current.toggleSort("score"));
    expect(result.current.sort).toEqual({ columnId: "score", direction: "asc" });
  });

  it("sorts numerically, not lexicographically, for a numeric accessor", () => {
    const rows: Row[] = [{ id: "1", name: "A", score: 9 }, { id: "2", name: "B", score: 10 }, { id: "3", name: "C", score: 2 }];
    const { result } = renderHook(() => useTableSort(rows, ACCESSORS));
    act(() => result.current.toggleSort("score"));
    // A naive string sort would read "10" < "2" < "9" -- this proves it doesn't.
    expect(result.current.sortedItems.map((r) => r.score)).toEqual([2, 9, 10]);
  });

  it("nulls always sort last, in both ascending and descending order", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    act(() => result.current.toggleSort("score"));
    expect(result.current.sortedItems.map((r) => r.score)).toEqual([10, 20, null]);
    act(() => result.current.toggleSort("score"));
    expect(result.current.sortedItems.map((r) => r.score)).toEqual([20, 10, null]);
  });

  it("re-renders with a fresh items array (e.g. after a refetch) while preserving the active sort", () => {
    const { result, rerender } = renderHook(({ items }) => useTableSort(items, ACCESSORS), { initialProps: { items: ROWS } });
    act(() => result.current.toggleSort("name"));

    const updated: Row[] = [...ROWS, { id: "4", name: "Aaron", score: 5 }];
    rerender({ items: updated });

    expect(result.current.sort).toEqual({ columnId: "name", direction: "asc" });
    expect(result.current.sortedItems.map((r) => r.name)).toEqual(["Aaron", "alice", "Bob", "Charlie"]);
  });

  it("does not mutate the original items array", () => {
    const original = [...ROWS];
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    act(() => result.current.toggleSort("name"));
    expect(ROWS).toEqual(original);
  });

  it("re-sorts when the accessors themselves change, even though items and the sort column/direction stay the same (review finding, PR #202: accessors was previously missing from the memo's own dependency array, so this would silently return a stale sort)", () => {
    const rows: Row[] = [
      { id: "1", name: "A", score: 1 },
      { id: "2", name: "B", score: 2 },
    ];
    const { result, rerender } = renderHook(
      ({ multiplier }) => useTableSort(rows, { name: (r) => r.name, score: (r) => (r.score ?? 0) * multiplier }),
      { initialProps: { multiplier: 1 } },
    );
    act(() => result.current.toggleSort("score"));
    expect(result.current.sortedItems.map((r) => r.id)).toEqual(["1", "2"]);

    // Same rows, same sort column/direction -- only the accessor's own
    // behaviour changes (a stand-in for a caller whose accessor closes
    // over reactive state, e.g. locale or a formatting preference).
    rerender({ multiplier: -1 });

    expect(result.current.sortedItems.map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("downgrades to an unsorted, consistent state if the active column's accessor disappears -- sort and sortedItems never disagree (review finding, PR #202: a caller's accessors map can be conditionally built, e.g. a column that stops being sortable)", () => {
    const { result, rerender } = renderHook(({ accessors }) => useTableSort(ROWS, accessors), {
      initialProps: { accessors: ACCESSORS as SortAccessors<Row> },
    });
    act(() => result.current.toggleSort("score"));
    expect(result.current.sort).toEqual({ columnId: "score", direction: "asc" });

    rerender({ accessors: { name: ACCESSORS.name } });

    expect(result.current.sort).toEqual({ columnId: null, direction: null });
    expect(result.current.sortedItems).toEqual(ROWS);
  });

  it("toggling a columnId with no accessor at all reports as unsorted, not as a phantom active sort", () => {
    const { result } = renderHook(() => useTableSort(ROWS, ACCESSORS));
    act(() => result.current.toggleSort("does-not-exist"));

    expect(result.current.sort).toEqual({ columnId: null, direction: null });
    expect(result.current.sortedItems).toEqual(ROWS);
  });

  it("does not create a latent sort when toggling a column with no accessor -- adding that column's accessor later does not retroactively spring it into a sorted state (review finding, PR #204)", () => {
    const { result, rerender } = renderHook(({ accessors }) => useTableSort(ROWS, accessors), {
      initialProps: { accessors: { name: ACCESSORS.name } as SortAccessors<Row> },
    });

    // "score" has no accessor yet -- must be a true no-op, not a hidden
    // internal state change.
    act(() => result.current.toggleSort("score"));
    expect(result.current.sort).toEqual({ columnId: null, direction: null });

    // "score"'s accessor becomes available (e.g. a feature flag turns
    // on). Without the fix, the earlier toggle would "spring back" here
    // and suddenly show as sorted by score, even though the click that
    // supposedly caused it had no visible effect at the time.
    rerender({ accessors: ACCESSORS });

    expect(result.current.sort).toEqual({ columnId: null, direction: null });
    expect(result.current.sortedItems).toEqual(ROWS);
  });
});
