import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableCell, TableHeaderCell } from "./Table";
import { ListView } from "./ListView";
import type { ListViewFilter } from "./ListView";

interface Fixture {
  id: string;
  name: string;
  role: string;
}

const ITEMS: Fixture[] = [
  { id: "1", name: "Alice", role: "player" },
  { id: "2", name: "Bob", role: "admin" },
];

// ghs#138: 25 items -- enough for 3 pages at the default pageSize (10),
// with a non-full last page (5 items) to exercise a real "partial last
// page" case, not just evenly-divisible counts.
const MANY_ITEMS: Fixture[] = Array.from({ length: 25 }, (_, index) => ({
  id: String(index + 1),
  name: `Item ${String(index + 1).padStart(2, "0")}`,
  role: index % 2 === 0 ? "player" : "admin",
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderList(
  items: Fixture[] = ITEMS,
  id = "fixtures",
  options: { getSearchText?: (item: Fixture) => string; filters?: Array<ListViewFilter<Fixture>>; pageSize?: number } = {},
) {
  return render(
    <ListView<Fixture>
      items={items}
      getKey={(item) => item.id}
      id={id}
      searchPlaceholder="Search…"
      getSearchText={options.getSearchText}
      filters={options.filters}
      pageSize={options.pageSize}
      tableHead={<TableHeaderCell>Name</TableHeaderCell>}
      renderTableRow={(item) => <TableCell>{item.name}</TableCell>}
      renderCard={(item) => <div data-testid={`card-${item.id}`}>{item.name}</div>}
      emptyState={<p>No fixtures yet.</p>}
    />,
  );
}

describe("ListView", () => {
  it("renders the table view by default", () => {
    renderList();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("switching to grid shows the same underlying items in the grid representation", async () => {
    renderList();
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-1")).toHaveTextContent("Alice");
    expect(screen.getByTestId("card-2")).toHaveTextContent("Bob");
  });

  it("persists the chosen view across a remount", async () => {
    const { unmount } = renderList();
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));
    unmount();

    renderList();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-1")).toBeInTheDocument();
  });

  it("shows the empty state instead of either view when there are no items", () => {
    renderList([]);
    expect(screen.getByText("No fixtures yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("gives the table/grid control a real programmatic group name (fieldset/legend, review finding PR #120)", () => {
    renderList();
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
  });

  it("keeps two different ids' persisted views independent", async () => {
    renderList(ITEMS, "screen-a");
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));
    cleanup();

    renderList(ITEMS, "screen-b");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("does not render a search box or filters when the screen doesn't opt in (ghs#137)", () => {
    renderList();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("free-text search narrows the rendered items client-side (ghs#137)", async () => {
    renderList(ITEMS, "fixtures", { getSearchText: (item) => item.name });
    await userEvent.type(screen.getByRole("searchbox"), "ali");

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("a column filter narrows the rendered items client-side (ghs#137)", async () => {
    renderList(ITEMS, "fixtures", {
      filters: [
        {
          id: "role",
          label: "Role",
          getValue: (item) => item.role,
          options: [
            { value: "player", label: "Player" },
            { value: "admin", label: "Admin" },
          ],
        },
      ],
    });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("combines search and a column filter as an AND, not an OR (ghs#137)", async () => {
    renderList(ITEMS, "fixtures", {
      getSearchText: (item) => item.name,
      filters: [
        {
          id: "role",
          label: "Role",
          getValue: (item) => item.role,
          options: [
            { value: "player", label: "Player" },
            { value: "admin", label: "Admin" },
          ],
        },
      ],
    });
    await userEvent.type(screen.getByRole("searchbox"), "ali");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("shows a generic no-matches state, distinct from the real empty state, when a search/filter excludes every item (ghs#137)", async () => {
    renderList(ITEMS, "fixtures", { getSearchText: (item) => item.name });
    await userEvent.type(screen.getByRole("searchbox"), "nobody-has-this-name");

    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryByText("No fixtures yet.")).not.toBeInTheDocument();
  });

  // ghs#138
  describe("pagination", () => {
    it("renders no pagination controls when everything already fits on one page", () => {
      renderList();
      expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    });

    it("shows only the first page's worth of items, with a real Previous/Next control, once the result set exceeds the page size", () => {
      renderList(MANY_ITEMS);

      expect(screen.getByText("Item 01")).toBeInTheDocument();
      expect(screen.getByText("Item 10")).toBeInTheDocument();
      expect(screen.queryByText("Item 11")).not.toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
      expect(screen.getByText("Page 1 of 3 · 25 results")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("Next/Previous navigate between pages, including a correctly-sized partial last page", async () => {
      renderList(MANY_ITEMS);

      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Page 2 of 3 · 25 results")).toBeInTheDocument();
      expect(screen.getByText("Item 11")).toBeInTheDocument();
      expect(screen.getByText("Item 20")).toBeInTheDocument();
      expect(screen.queryByText("Item 01")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();

      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Page 3 of 3 · 25 results")).toBeInTheDocument();
      // Partial last page -- only 5 items (21-25), not a full 10.
      expect(screen.getByText("Item 21")).toBeInTheDocument();
      expect(screen.getByText("Item 25")).toBeInTheDocument();
      expect(screen.queryByText("Item 20")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Previous" }));
      expect(screen.getByText("Page 2 of 3 · 25 results")).toBeInTheDocument();
    });

    it("resets to page 1 when a search/filter narrows the result set (ghs#137 + #138 interaction)", async () => {
      renderList(MANY_ITEMS, "fixtures", { getSearchText: (item) => item.name });
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Page 2 of 3 · 25 results")).toBeInTheDocument();

      // Narrows to 9 matches (Item 01..Item 09) -- fits on one page, so
      // no pagination nav at all, and definitely not left on "page 2".
      await userEvent.type(screen.getByRole("searchbox"), "Item 0");
      expect(await screen.findByText("Item 01")).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    });

    it("clamps to the last real page rather than showing an empty page when the result set shrinks further still", async () => {
      renderList(MANY_ITEMS, "fixtures", { getSearchText: (item) => item.name });
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Page 3 of 3 · 25 results")).toBeInTheDocument();

      // Narrows to exactly 1 match -- was on "page 3", must not render a
      // now-nonexistent page.
      await userEvent.type(screen.getByRole("searchbox"), "Item 07");
      expect(screen.getByText("Item 07")).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    });

    it("respects a screen-provided pageSize override", () => {
      renderList(MANY_ITEMS, "fixtures", { pageSize: 5 });
      expect(screen.getByText("Page 1 of 5 · 25 results")).toBeInTheDocument();
      expect(screen.getByText("Item 05")).toBeInTheDocument();
      expect(screen.queryByText("Item 06")).not.toBeInTheDocument();
    });

    it("paginates the grid view the same way as the table view", async () => {
      renderList(MANY_ITEMS);
      await userEvent.click(screen.getByRole("radio", { name: "Grid" }));

      expect(screen.getByTestId("card-1")).toBeInTheDocument();
      expect(screen.queryByTestId("card-11")).not.toBeInTheDocument();
      expect(screen.getByText("Page 1 of 3 · 25 results")).toBeInTheDocument();
    });
  });
});
