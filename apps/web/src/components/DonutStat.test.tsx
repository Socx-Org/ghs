import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DonutStat } from "./DonutStat";
import type { DonutStatSegment } from "./DonutStat";

afterEach(() => {
  cleanup();
});

const HIT_MISSED: DonutStatSegment[] = [
  { label: "Hit", value: 62, colorClass: "bg-success" },
  { label: "Missed", value: 38, colorClass: "bg-warning" },
];

describe("DonutStat", () => {
  it("renders every segment's rounded percentage as real accessible text, not just a chart", () => {
    render(<DonutStat segments={HIT_MISSED} centerLabel="62%" />);
    expect(screen.getByText("Hit")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
    // "62%" appears twice -- once as the chart's own (aria-hidden)
    // centre label, once in the real accessible <dl> legend -- asserted
    // as exactly 2, not a selector-scoped single match, so the centre
    // label's presence is actually verified rather than merely
    // tolerated (review finding, PR #226: getAllByText already throws
    // on zero matches, so a ">= 1" assertion here never actually
    // distinguished "both render" from "only one does").
    expect(screen.getAllByText("62%")).toHaveLength(2);
    expect(screen.getByText("38%")).toBeInTheDocument();
  });

  it("ghs#227: renders an arbitrary number of segments (not just 2) -- Putting's real 3-category 1-putt/2-putt/3+-putt split", () => {
    render(
      <DonutStat
        centerLabel="2.1"
        segments={[
          { label: "1-putt", value: 30, colorClass: "bg-success" },
          { label: "2-putt", value: 50, colorClass: "bg-primary" },
          { label: "3+ putt", value: 20, colorClass: "bg-warning" },
        ]}
      />,
    );
    expect(screen.getByText("1-putt")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("2-putt")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("3+ putt")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("renders correctly with duplicate segment labels, i.e. doesn't key solely on label (same reasoning as SegmentedBar's own review fix, PR #182)", () => {
    render(
      <DonutStat
        centerLabel="--"
        segments={[
          { label: "Missed", value: 30, colorClass: "bg-danger" },
          { label: "Missed", value: 70, colorClass: "bg-warning" },
        ]}
      />,
    );
    expect(screen.getAllByText("Missed")).toHaveLength(2);
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("the donut chart itself is aria-hidden -- the <dl> legend is the real accessible content", () => {
    const { container } = render(<DonutStat segments={HIT_MISSED} centerLabel="62%" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(container.querySelector("dl")).toBeInTheDocument();
  });

  it("renders an optional caption (e.g. Penalties'/Putting's existing per-round average) beneath the legend", () => {
    render(<DonutStat segments={HIT_MISSED} centerLabel="62%" caption="1.2/round" />);
    expect(screen.getByText("1.2/round")).toBeInTheDocument();
  });

  it("omits the caption paragraph entirely when none is given", () => {
    const { container } = render(<DonutStat segments={HIT_MISSED} centerLabel="62%" />);
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("clamps an out-of-range segment value to [0, 100] rather than overflowing the chart (same reasoning as SegmentedBar's own clampPercent, PR #182)", () => {
    render(<DonutStat centerLabel="--" segments={[{ label: "Bad data", value: 140, colorClass: "bg-danger" }]} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("clamps a negative segment value to 0", () => {
    render(<DonutStat centerLabel="--" segments={[{ label: "Bad data", value: -20, colorClass: "bg-danger" }]} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("treats a non-finite segment value (NaN/Infinity) as 0 rather than rendering invalid chart data", () => {
    render(<DonutStat centerLabel="--" segments={[{ label: "Bad data", value: NaN, colorClass: "bg-danger" }]} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
