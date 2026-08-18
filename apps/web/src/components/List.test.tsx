import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, ListItem } from "./List";

afterEach(() => {
  cleanup();
});

describe("ListItem", () => {
  it("is not focusable or button-like by default", () => {
    render(
      <List>
        <ListItem>Sunningdale (Old)</ListItem>
      </List>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("activates via click when interactive", async () => {
    const onClick = vi.fn();
    render(
      <List>
        <ListItem interactive onClick={onClick}>
          Sunningdale (Old)
        </ListItem>
      </List>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sunningdale (Old)" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("activates via keyboard (Enter and Space) when interactive -- not click-only", async () => {
    const onClick = vi.fn();
    render(
      <List>
        <ListItem interactive onClick={onClick}>
          Sunningdale (Old)
        </ListItem>
      </List>,
    );
    const item = screen.getByRole("button", { name: "Sunningdale (Old)" });
    item.focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);

    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
