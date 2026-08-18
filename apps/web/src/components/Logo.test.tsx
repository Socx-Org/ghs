import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Logo } from "./Logo";

afterEach(() => {
  cleanup();
});

describe("Logo", () => {
  it("has an accessible name via role=img/aria-label, defaulting to SOCX", () => {
    render(<Logo />);
    expect(screen.getByRole("img", { name: "SOCX" })).toBeInTheDocument();
  });

  it("accepts a context-specific accessible label", () => {
    render(<Logo label="GHS home" />);
    expect(screen.getByRole("img", { name: "GHS home" })).toBeInTheDocument();
  });

  it("hides the decorative mark SVG and wordmark text from assistive tech individually", () => {
    const { container } = render(<Logo variant="full" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg + span")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders only the mark (no wordmark text) for variant=mark", () => {
    const { container } = render(<Logo variant="mark" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.textContent).toBe("");
  });
});
