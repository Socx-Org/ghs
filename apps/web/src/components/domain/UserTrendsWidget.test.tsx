import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserTrendsWidget } from "./UserTrendsWidget";
import type { RegistrationTrendPoint } from "../../types/domain";

afterEach(() => {
  cleanup();
});

// Same technique as HandicapTrendWidget.test.tsx's own withTimeZone --
// restored unconditionally, even on failure, so one bad assertion can't
// leak a wrong TZ into every other test in the file.
function withTimeZone(timeZone: string, run: () => void): void {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    run();
  } finally {
    process.env.TZ = original;
  }
}

function point(date: string, count: number): RegistrationTrendPoint {
  return { date, count };
}

function renderWidget(overrides: Partial<Parameters<typeof UserTrendsWidget>[0]> = {}) {
  const onPeriodChange = vi.fn();
  const result = render(
    <UserTrendsWidget
      period="30d"
      onPeriodChange={onPeriodChange}
      isLoading={false}
      isError={false}
      data={[]}
      {...overrides}
    />,
  );
  return { onPeriodChange, ...result };
}

describe("UserTrendsWidget", () => {
  it("shows a loading skeleton when isLoading", () => {
    const { container } = renderWidget({ isLoading: true });
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows the error message when isError", () => {
    renderWidget({ isError: true, errorMessage: "Couldn't load the dashboard." });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the dashboard.");
  });

  it("shows an empty state for zero registration points", () => {
    renderWidget({ data: [] });
    expect(screen.getByText("No registrations yet")).toBeInTheDocument();
  });

  it("shows a real accessible data table once there's real data", () => {
    renderWidget({ data: [point("2026-05-01", 3), point("2026-05-02", 1)] });
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("3")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("1")).toBeInTheDocument();
  });

  it("formats a bare YYYY-MM-DD date without a UTC-midnight day-shift, under a real negative-UTC-offset timezone", () => {
    withTimeZone("America/Los_Angeles", () => {
      renderWidget({ data: [point("2026-05-01", 3)] });
      const table = screen.getByRole("table");
      // The pre-fix `new Date("2026-05-01")` parses as UTC midnight,
      // which is still Apr 30 in America/Los_Angeles (UTC-7/-8) -- the
      // exact wrong-calendar-day bug HandicapTrendWidget's own PR #95/
      // #168/#173 fixes already regress against.
      expect(within(table).getByText("May 1")).toBeInTheDocument();
    });
  });

  it("reflects the given period in the selector and calls onPeriodChange when a different one is picked", async () => {
    const { onPeriodChange } = renderWidget({ period: "7d" });
    expect(screen.getByRole("radio", { name: "7d" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "30d" })).not.toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "90d" }));
    expect(onPeriodChange).toHaveBeenCalledWith("90d");
  });

  it("the period selector renders regardless of loading/error status, so switching periods works even mid-load or after a failed request", () => {
    renderWidget({ isLoading: true });
    expect(screen.getByRole("radio", { name: "30d" })).toBeInTheDocument();

    cleanup();
    renderWidget({ isError: true });
    expect(screen.getByRole("radio", { name: "30d" })).toBeInTheDocument();
  });
});
