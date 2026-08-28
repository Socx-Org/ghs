import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SegmentedBar } from "./SegmentedBar";

afterEach(() => {
  cleanup();
});

const FIR_SEGMENTS = [
  { label: "Missed left", value: 20, colorClass: "bg-danger" },
  { label: "Hit", value: 55, colorClass: "bg-success" },
  { label: "Missed right", value: 25, colorClass: "bg-warning" },
];

describe("SegmentedBar", () => {
  it("renders the headline and headline label", () => {
    render(<SegmentedBar headline="55%" headlineLabel="Fairways in regulation" segments={FIR_SEGMENTS} />);
    // Selector-scoped: the "Hit" segment below also happens to be 55%,
    // which otherwise collides with the headline's own concatenated
    // "55%" text (its digits and "%" are separate DOM text nodes).
    expect(screen.getByText("55%", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Fairways in regulation")).toBeInTheDocument();
  });

  it("renders segments in the given (spatial) order, not reordered by value", () => {
    render(<SegmentedBar headline="55%" segments={FIR_SEGMENTS} />);
    const labels = screen.getAllByText(/Missed left|Hit|Missed right/).map((el) => el.textContent);
    expect(labels).toEqual(["Missed left", "Hit", "Missed right"]);
  });

  it("renders each segment's rounded percentage as real accessible text, not just a coloured bar", () => {
    render(<SegmentedBar headline="55%" segments={FIR_SEGMENTS} />);
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("the coloured bar itself is aria-hidden -- the legend is the real accessible content", () => {
    const { container } = render(<SegmentedBar headline="55%" segments={FIR_SEGMENTS} />);
    const bar = container.querySelector('[aria-hidden="true"]');
    expect(bar).toBeInTheDocument();
  });
});
