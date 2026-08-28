import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HandicapTrendWidget } from "./HandicapTrendWidget";
import type { HandicapHistoryRecord } from "../../types/domain";

afterEach(() => {
  cleanup();
});

// Same technique as lib/dates.test.ts's own withTimeZone -- restored
// unconditionally, even on failure, so one bad assertion can't leak a
// wrong TZ into every other test in the file.
function withTimeZone(timeZone: string, run: () => void): void {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    run();
  } finally {
    process.env.TZ = original;
  }
}

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

  it("ghs#117 review fix: formats a bare YYYY-MM-DD date without a UTC-midnight day-shift, under a real negative-UTC-offset timezone", () => {
    withTimeZone("America/Los_Angeles", () => {
      render(<HandicapTrendWidget isLoading={false} isError={false} history={[record("h1", "2026-05-01", 14.2), record("h2", "2026-06-01", 12.4)]} />);
      const table = screen.getByRole("table");
      // The pre-fix `new Date("2026-05-01")` parses as UTC midnight,
      // which is still Apr 30 in America/Los_Angeles (UTC-7/-8) -- the
      // exact wrong-calendar-day bug this regresses.
      expect(within(table).getByText("May 1, 2026")).toBeInTheDocument();
      expect(within(table).getByText("Jun 1, 2026")).toBeInTheDocument();
    });
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
