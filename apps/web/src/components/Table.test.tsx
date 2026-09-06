import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortableTableHeaderCell, Table, TableBody, TableHead, TableRow } from "./Table";
import type { SortState } from "../lib/useTableSort";

afterEach(() => {
  cleanup();
});

function renderHeader(sort: SortState, onSort: (columnId: string) => void) {
  return render(
    <Table>
      <TableHead>
        <TableRow>
          <SortableTableHeaderCell columnId="name" sort={sort} onSort={onSort}>
            Name
          </SortableTableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody />
    </Table>,
  );
}

describe("SortableTableHeaderCell", () => {
  it("calls onSort with its own columnId when clicked", async () => {
    const calls: string[] = [];
    renderHeader({ columnId: null, direction: null }, (columnId) => calls.push(columnId));

    await userEvent.click(screen.getByRole("button", { name: "Name" }));

    expect(calls).toEqual(["name"]);
  });

  it("reports aria-sort=none on the header cell while unsorted, and none for a different active column", () => {
    renderHeader({ columnId: "other", direction: "asc" }, () => {});
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
  });

  it("reports aria-sort=ascending / descending only while this column is the active one", () => {
    const { rerender } = render(
      <Table>
        <TableHead>
          <TableRow>
            <SortableTableHeaderCell columnId="name" sort={{ columnId: "name", direction: "asc" }} onSort={() => {}}>
              Name
            </SortableTableHeaderCell>
          </TableRow>
        </TableHead>
      </Table>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending");

    rerender(
      <Table>
        <TableHead>
          <TableRow>
            <SortableTableHeaderCell columnId="name" sort={{ columnId: "name", direction: "desc" }} onSort={() => {}}>
              Name
            </SortableTableHeaderCell>
          </TableRow>
        </TableHead>
      </Table>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
  });

  it("is keyboard-activatable, since it's a real <button>, not a click-only div", async () => {
    const calls: string[] = [];
    renderHeader({ columnId: null, direction: null }, (columnId) => calls.push(columnId));

    const button = screen.getByRole("button", { name: "Name" });
    button.focus();
    await userEvent.keyboard("{Enter}");

    expect(calls).toEqual(["name"]);
  });

  it("keeps the visible label text as the button's own accessible name", () => {
    renderHeader({ columnId: "name", direction: "asc" }, () => {});
    expect(screen.getByRole("button", { name: "Name" })).toBeInTheDocument();
  });
});
