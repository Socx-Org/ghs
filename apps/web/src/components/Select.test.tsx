import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

afterEach(() => {
  cleanup();
});

describe("Select", () => {
  it("selects an option via the keyboard", async () => {
    render(
      <Select aria-label="Course" defaultValue="">
        <option value="" disabled>
          Choose
        </option>
        <option value="sunningdale">Sunningdale</option>
        <option value="wentworth">Wentworth</option>
      </Select>,
    );
    const select = screen.getByLabelText("Course");
    await userEvent.selectOptions(select, "wentworth");
    expect(select).toHaveValue("wentworth");
  });

  it("sets aria-invalid when marked invalid", () => {
    render(
      <Select aria-label="Course" invalid>
        <option>Sunningdale</option>
      </Select>,
    );
    expect(screen.getByLabelText("Course")).toHaveAttribute("aria-invalid", "true");
  });
});
