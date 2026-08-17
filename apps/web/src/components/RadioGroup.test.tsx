import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroup } from "./RadioGroup";

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: "18", label: "18 holes" },
  { value: "9", label: "9 holes" },
];

describe("RadioGroup", () => {
  it("exposes a radiogroup role and reports selection via onChange", async () => {
    const onChange = vi.fn();
    render(<RadioGroup name="round-type" options={OPTIONS} value="18" onChange={onChange} />);

    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("9 holes"));
    expect(onChange).toHaveBeenCalledWith("9");
  });

  it("marks the selected option as checked", () => {
    render(<RadioGroup name="round-type" options={OPTIONS} value="9" />);
    expect(screen.getByLabelText("9 holes")).toBeChecked();
    expect(screen.getByLabelText("18 holes")).not.toBeChecked();
  });

  it("disables an individual option independently of the group", () => {
    render(<RadioGroup name="round-type" options={[OPTIONS[0], { ...OPTIONS[1], disabled: true }]} value="18" />);
    expect(screen.getByLabelText("9 holes")).toBeDisabled();
    expect(screen.getByLabelText("18 holes")).not.toBeDisabled();
  });
});
