import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./Textarea";

afterEach(() => {
  cleanup();
});

describe("Textarea", () => {
  it("accepts typed input and reports the value via onChange", async () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="Rejection reason" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Rejection reason"), "Missing hole 3 score.");
    expect(onChange).toHaveBeenCalled();
  });

  it("sets aria-invalid when marked invalid", () => {
    render(<Textarea aria-label="Rejection reason" invalid />);
    expect(screen.getByLabelText("Rejection reason")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-invalid by default", () => {
    render(<Textarea aria-label="Rejection reason" />);
    expect(screen.getByLabelText("Rejection reason")).not.toHaveAttribute("aria-invalid");
  });

  it("cannot be typed into while disabled", async () => {
    render(<Textarea aria-label="Rejection reason" disabled />);
    const textarea = screen.getByLabelText("Rejection reason");
    expect(textarea).toBeDisabled();
    await userEvent.type(textarea, "Missing hole 3 score.");
    expect(textarea).toHaveValue("");
  });

  it("defaults to 3 rows", () => {
    render(<Textarea aria-label="Rejection reason" />);
    expect(screen.getByLabelText("Rejection reason")).toHaveAttribute("rows", "3");
  });
});
