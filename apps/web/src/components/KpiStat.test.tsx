import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KpiStat } from "./KpiStat";

afterEach(() => {
  cleanup();
});

describe("KpiStat", () => {
  it("renders the label, value, and secondary line", () => {
    render(<KpiStat label="Pending review" value={7} secondary="Since yesterday" />);
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Since yesterday")).toBeInTheDocument();
  });

  it("value is neutral text colour when no accent is given", () => {
    render(<KpiStat label="Total users" value={128} />);
    expect(screen.getByText("128")).toHaveClass("text-text");
  });

  it("accent colours the value, e.g. warning for Pending Review", () => {
    render(<KpiStat label="Pending review" value={7} accent="warning" />);
    expect(screen.getByText("7")).toHaveClass("text-warning");
  });

  it("the secondary line is a <dd>, not a <p> -- a <dl> may only contain dt/dd (review finding, PR #182)", () => {
    render(<KpiStat label="Total users" value={128} secondary="112 players · 14 admin · 2 super admin" />);
    expect(screen.getByText("112 players · 14 admin · 2 super admin").tagName).toBe("DD");
  });
});
