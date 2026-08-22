import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HolesTable } from "./HolesTable";
import type { HoleScore } from "../../types/domain";

// ghs#147: extracted from AdminRoundReviewPage (#67) -- direct unit
// coverage for the shared component, on top of the existing coverage
// through that page's own tests.

const HOLES = [
  { id: "hole-1", holeNumber: 1, par: 4 },
  { id: "hole-2", holeNumber: 2, par: 3 },
];

function makeScore(overrides: Partial<HoleScore> = {}): HoleScore {
  return {
    id: "hs-1", holeNumber: 1, strokes: 5, putts: 2, gir: false,
    fairwayResult: "hit", inSand: false, penalties: 0, netDoubleBogeyAdjusted: 5,
    ...overrides,
  };
}

describe("HolesTable", () => {
  it("renders a row per hole, with real recorded values", () => {
    render(<HolesTable holes={HOLES} holeScores={[makeScore()]} />);

    const row = screen.getByText("1", { selector: "td" }).closest("tr")!;
    expect(within(row).getByText("4")).toBeInTheDocument(); // par
    expect(within(row).getByText("5")).toBeInTheDocument(); // strokes
    expect(within(row).getByText("2")).toBeInTheDocument(); // putts
    expect(within(row).getByText("Hit")).toBeInTheDocument();
  });

  it("shows a dash for a hole with no recorded score yet", () => {
    render(<HolesTable holes={HOLES} holeScores={[makeScore({ holeNumber: 1 })]} />);

    // Hole 2 has no matching score -- every one of its cells falls back to "—".
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("labels every fairwayResult value, including null", () => {
    const scores: HoleScore[] = [
      makeScore({ holeNumber: 1, fairwayResult: "missed_left" }),
      makeScore({ id: "hs-2", holeNumber: 2, fairwayResult: "missed_right" }),
    ];
    render(<HolesTable holes={HOLES} holeScores={scores} />);

    expect(screen.getByText("Missed L")).toBeInTheDocument();
    expect(screen.getByText("Missed R")).toBeInTheDocument();
  });
});
