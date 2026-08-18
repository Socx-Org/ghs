import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FormField } from "./FormField";
import { Input } from "./Input";

afterEach(() => {
  cleanup();
});

describe("FormField", () => {
  it("associates the label with the control via htmlFor/id", () => {
    render(
      <FormField label="Player name">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText("Player name")).toBeInTheDocument();
  });

  it("wires help text via aria-describedby when there is no error", () => {
    render(
      <FormField label="Email" helpText="We'll never share this.">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText("Email");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByText("We'll never share this.")).toHaveAttribute("id", describedBy);
  });

  it("wires the error message via aria-describedby and aria-invalid, and hides help text", () => {
    render(
      <FormField label="Player name" helpText="Shown only without an error" error="Player name is required.">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText("Player name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("Player name is required.");
    expect(input.getAttribute("aria-describedby")).toContain(errorEl.id);
    expect(screen.queryByText("Shown only without an error")).not.toBeInTheDocument();
  });

  it("communicates required fields accessibly, not by colour alone", () => {
    render(
      <FormField label="Player name" required>
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText<HTMLInputElement>(/Player name/);
    // The visible "*" is aria-hidden (decorative only); the accessible
    // name carries the "required" information via sr-only text instead,
    // so it isn't communicated by colour/symbol alone.
    expect(input.labels?.[0]).toHaveTextContent("(required)");
  });
});
