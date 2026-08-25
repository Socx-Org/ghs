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

  // ghs#134 review fix: iconOnly with an option missing its icon would
  // otherwise silently render with no visible affordance at all.
  it("logs a dev warning when iconOnly is set but an option has no icon", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ToggleGroup name="view" options={OPTIONS} value="list" iconOnly />);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("List, Table"));
    spy.mockRestore();
  });

  it("does not warn when iconOnly is set and every option has an icon", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ToggleGroup
        name="view"
        value="list"
        iconOnly
        options={[
          { value: "list", label: "List", icon: <svg aria-hidden="true" /> },
          { value: "table", label: "Table", icon: <svg aria-hidden="true" /> },
        ]}
      />,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
