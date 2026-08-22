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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderList(
  items: Fixture[] = ITEMS,
  id = "fixtures",
  options: { getSearchText?: (item: Fixture) => string; filters?: Array<ListViewFilter<Fixture>> } = {},
) {
  return render(
    <ListView<Fixture>
      items={items}
      getKey={(item) => item.id}
      id={id}
      searchPlaceholder="Search…"
      getSearchText={options.getSearchText}
      filters={options.filters}
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
});
