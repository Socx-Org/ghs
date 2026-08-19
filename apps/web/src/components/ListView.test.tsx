import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableCell, TableHeaderCell } from "./Table";
import { ListView } from "./ListView";

interface Fixture {
  id: string;
  name: string;
}

const ITEMS: Fixture[] = [
  { id: "1", name: "Alice" },
  { id: "2", name: "Bob" },
];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderList(items: Fixture[] = ITEMS, id = "fixtures") {
  return render(
    <ListView<Fixture>
      items={items}
      getKey={(item) => item.id}
      id={id}
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

  it("keeps two different ids' persisted views independent", async () => {
    renderList(ITEMS, "screen-a");
    await userEvent.click(screen.getByRole("radio", { name: "Grid" }));
    cleanup();

    renderList(ITEMS, "screen-b");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
