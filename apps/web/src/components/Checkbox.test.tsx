import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox";

afterEach(() => {
  cleanup();
});

describe("Checkbox", () => {
  it("toggles via click and via the keyboard (space)", async () => {
    render(<Checkbox aria-label="Tournament round" />);
    const checkbox = screen.getByLabelText("Tournament round");
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    checkbox.focus();
    await userEvent.keyboard(" ");
    expect(checkbox).not.toBeChecked();
  });
});
