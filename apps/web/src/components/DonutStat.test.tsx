import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DonutStat } from "./DonutStat";

afterEach(() => {
  cleanup();
});

describe("DonutStat", () => {
  it("renders both segments' rounded percentages as real accessible text, not just a chart", () => {
    render(<DonutStat value={62} primaryLabel="Hit" secondaryLabel="Missed" />);
    expect(screen.getByText("Hit")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
    // "62%" appears twice -- once as the chart's own (aria-hidden)
    // centre label, once in the real accessible <dl> legend -- so this
    // asserts there are at least two, rather than picking one by a
    // selector that would make the centre label's presence untested.
    expect(screen.getAllByText("62%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("38%")).toBeInTheDocument();
  });

  it("the donut chart itself is aria-hidden -- the <dl> legend is the real accessible content", () => {
    const { container } = render(<DonutStat value={62} primaryLabel="Hit" secondaryLabel="Missed" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(container.querySelector("dl")).toBeInTheDocument();
  });

  it("renders an optional caption (e.g. Penalties' existing per-round average) beneath the legend", () => {
    render(<DonutStat value={78} primaryLabel="Penalty-free" secondaryLabel="Penalty" caption="1.2/round" />);
    expect(screen.getByText("1.2/round")).toBeInTheDocument();
  });

  it("omits the caption paragraph entirely when none is given", () => {
    const { container } = render(<DonutStat value={78} primaryLabel="Penalty-free" secondaryLabel="Penalty" />);
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("clamps an out-of-range value to [0, 100] rather than producing a negative secondary segment (same reasoning as SegmentedBar's own clampPercent, PR #182)", () => {
    render(<DonutStat value={140} primaryLabel="Hit" secondaryLabel="Missed" />);
    expect(screen.getAllByText("100%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("clamps a negative value to 0", () => {
    render(<DonutStat value={-20} primaryLabel="Hit" secondaryLabel="Missed" />);
    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("treats a non-finite value (NaN/Infinity) as 0 rather than rendering invalid chart data", () => {
    render(<DonutStat value={NaN} primaryLabel="Hit" secondaryLabel="Missed" />);
    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
