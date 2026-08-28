import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HandicapTrendWidget } from "./HandicapTrendWidget";
import type { HandicapHistoryRecord } from "../../types/domain";

afterEach(() => {
  cleanup();
});

function record(id: string, calculationDate: string, handicapIndex: number): HandicapHistoryRecord {
  return {
    id,
    playerId: "player-1",
    method: "calculated",
    handicapIndex,
    previousIndex: null,
    reason: null,
    createdBy: null,
    calculationSnapshot: null,
    calculationDate,
    createdAt: calculationDate,
  };
}

describe("HandicapTrendWidget", () => {
  it("shows a loading skeleton when isLoading", () => {
    const { container } = render(<HandicapTrendWidget isLoading isError={false} history={[]} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows the error message when isError", () => {
    render(<HandicapTrendWidget isLoading={false} isError errorMessage="Couldn't load your handicap history." history={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your handicap history.");
  });

  it("isIdle renders nothing in the body -- a prerequisite (e.g. profile) failed elsewhere", () => {
    render(<HandicapTrendWidget isIdle isLoading={false} isError={false} history={[]} />);
    expect(screen.getByText("Handicap trend")).toBeInTheDocument();
    expect(screen.queryByText("Not yet established")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the 'not yet established' empty state for zero history rows -- matches PlayerDashboardPage's own established wording for the same eligibility rule", () => {
    render(<HandicapTrendWidget isLoading={false} isError={false} history={[]} />);
    expect(screen.getByText("Not yet established")).toBeInTheDocument();
    expect(screen.getByText(/Submit at least 3 rounds/)).toBeInTheDocument();
  });

  it("ghs#117: shows 'not enough history yet' for exactly one change -- a single point isn't a real trend", () => {
    render(<HandicapTrendWidget isLoading={false} isError={false} history={[record("h1", "2026-05-01", 14.2)]} />);
    expect(screen.getByText("Not enough history yet")).toBeInTheDocument();
  });

  it("shows the current index as the secondary metric and a real accessible data table once there's a real trend", () => {
    render(
      <HandicapTrendWidget
        isLoading={false}
        isError={false}
        history={[record("h1", "2026-05-01", 14.2), record("h2", "2026-06-01", 12.4)]}
      />,
    );

    expect(screen.getByText("Current 12.4")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("14.2")).toBeInTheDocument();
    expect(within(table).getByText("12.4")).toBeInTheDocument();
  });

  it("sorts oldest-first for the trend regardless of the order given (the backend returns newest-first)", () => {
    render(
      <HandicapTrendWidget
        isLoading={false}
        isError={false}
        history={[record("h2", "2026-06-01", 12.4), record("h1", "2026-05-01", 14.2)]}
      />,
    );

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // rows[0] is the header row -- the first data row must be the
    // OLDEST change (14.2), not whatever order the caller passed in.
    expect(within(rows[1]!).getByText("14.2")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("12.4")).toBeInTheDocument();
  });
});
