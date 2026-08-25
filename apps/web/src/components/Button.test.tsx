import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

afterEach(() => {
  cleanup();
});

describe("Button", () => {
  it("renders children and responds to a click", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and non-interactive while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Save
      </Button>,
    );
    // Not matched by name "Save" -- the Spinner's own sr-only label
    // ("Loading") is included in the button's accessible name while
    // loading, which is correct (it's real information), just not an
    // exact match against the plain label anymore.
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uses aria-label as the accessible name for an icon-only button", () => {
    render(
      <Button aria-label="Close">
        <svg aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("logs a dev warning for an icon-only button with no aria-label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Button />);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("aria-label"));
    spy.mockRestore();
  });

  // ghs#134
  it("renders a leading icon alongside a visible text label", () => {
    render(<Button icon={<svg data-testid="leading-icon" aria-hidden="true" />}>Back</Button>);
    const button = screen.getByRole("button", { name: "Back" });
    expect(within(button).getByTestId("leading-icon")).toBeInTheDocument();
  });

  it("shows the loading spinner instead of the icon, not alongside it, while isLoading is true", () => {
    render(
      <Button isLoading icon={<svg data-testid="leading-icon" aria-hidden="true" />}>
        Back
      </Button>,
    );
    expect(screen.queryByTestId("leading-icon")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });
});
