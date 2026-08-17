import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./Input";

afterEach(() => {
  cleanup();
});

describe("Input", () => {
  it("accepts typed input and reports the value via onChange", async () => {
    const onChange = vi.fn();
    render(<Input aria-label="Player name" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Player name"), "Alice");
    expect(onChange).toHaveBeenCalled();
  });

  it("sets aria-invalid when marked invalid", () => {
    render(<Input aria-label="Player name" invalid />);
    expect(screen.getByLabelText("Player name")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-invalid by default", () => {
    render(<Input aria-label="Player name" />);
    expect(screen.getByLabelText("Player name")).not.toHaveAttribute("aria-invalid");
  });

  it("cannot be typed into while disabled", async () => {
    render(<Input aria-label="Player name" disabled />);
    const input = screen.getByLabelText("Player name");
    expect(input).toBeDisabled();
    await userEvent.type(input, "Alice");
    expect(input).toHaveValue("");
  });
});
