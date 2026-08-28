import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RankingList } from "./RankingList";

afterEach(() => {
  cleanup();
});

describe("RankingList", () => {
  it("renders items in the given order with their rank number, label, and value", () => {
    render(
      <RankingList
        items={[
          { id: "c1", label: "Sunningdale (Old)", value: "42 rounds", share: 100 },
          { id: "c2", label: "St Andrews (Old)", value: "31 rounds", share: 74 },
        ]}
      />,
    );
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent("1");
    expect(listItems[0]).toHaveTextContent("Sunningdale (Old)");
    expect(listItems[0]).toHaveTextContent("42 rounds");
    expect(listItems[1]).toHaveTextContent("2");
    expect(listItems[1]).toHaveTextContent("St Andrews (Old)");
  });

  it("renders an avatar only for entries that provide avatarName, e.g. players but not courses", () => {
    render(
      <RankingList
        items={[
          { id: "p1", label: "Alice Whitfield", avatarName: "Alice Whitfield", secondary: "HI 12.4", value: 18, share: 100 },
          { id: "c1", label: "Sunningdale (Old)", value: "42 rounds", share: 80 },
        ]}
      />,
    );
    expect(screen.getByText("Alice Whitfield", { selector: "p" })).toBeInTheDocument();
    // Avatar renders a visually-hidden span with the full name for a11y.
    expect(screen.getAllByText("Alice Whitfield")).toHaveLength(2);
    expect(screen.getByText("HI 12.4")).toBeInTheDocument();
  });

  it("clamps an out-of-range share to [0, 100] rather than overflowing the bar (review finding, PR #182)", () => {
    const { container } = render(<RankingList items={[{ id: "c1", label: "Sunningdale (Old)", value: "42 rounds", share: 140 }]} />);
    const fill = container.querySelector(".bg-primary");
    expect(fill).toHaveStyle({ width: "100%" });
  });

  it("clamps a negative share to 0 (review finding, PR #182)", () => {
    const { container } = render(<RankingList items={[{ id: "c1", label: "Sunningdale (Old)", value: "42 rounds", share: -10 }]} />);
    const fill = container.querySelector(".bg-primary");
    expect(fill).toHaveStyle({ width: "0%" });
  });

  it("treats a non-finite share (NaN/Infinity) as 0 rather than rendering an invalid width (review finding, PR #182)", () => {
    const { container } = render(<RankingList items={[{ id: "c1", label: "Sunningdale (Old)", value: "42 rounds", share: Infinity }]} />);
    const fill = container.querySelector(".bg-primary");
    expect(fill).toHaveStyle({ width: "0%" });
  });
});
