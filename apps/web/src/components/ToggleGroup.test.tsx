import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToggleGroup } from "./ToggleGroup";

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: "list", label: "List" },
  { value: "table", label: "Table" },
];

describe("ToggleGroup", () => {
  it("reports selection via onChange on click", async () => {
    const onChange = vi.fn();
    render(<ToggleGroup name="view" options={OPTIONS} value="list" onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("Table"));
    expect(onChange).toHaveBeenCalledWith("table");
  });

  it("marks the selected option as checked", () => {
    render(<ToggleGroup name="view" options={OPTIONS} value="table" />);
    expect(screen.getByLabelText("Table")).toBeChecked();
    expect(screen.getByLabelText("List")).not.toBeChecked();
  });

  it("supports arrow-key navigation between options -- native radio behaviour, not hand-rolled", async () => {
    const onChange = vi.fn();
    render(<ToggleGroup name="view" options={OPTIONS} value="list" onChange={onChange} />);
    const list = screen.getByLabelText("List");
    list.focus();
    await userEvent.keyboard("{ArrowRight}");
    // Native same-name radio groups move focus AND selection together on
    // arrow keys -- this is browser behaviour, not something ToggleGroup
    // implements itself, which is exactly the point of building it on
    // real <input type="radio"> elements.
    expect(screen.getByLabelText("Table")).toHaveFocus();
  });

  it("disables an individual option independently of the group", () => {
    render(<ToggleGroup name="view" options={[OPTIONS[0], { ...OPTIONS[1], disabled: true }]} value="list" />);
    expect(screen.getByLabelText("Table")).toBeDisabled();
    expect(screen.getByLabelText("List")).not.toBeDisabled();
  });
});
