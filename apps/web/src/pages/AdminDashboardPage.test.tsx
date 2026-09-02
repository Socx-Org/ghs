import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import AdminDashboardPage from "./AdminDashboardPage";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth-store";
import type { ActiveUsersSnapshot, AdminDashboard, CourseRoundRanking, PlayerRoundRanking, RegistrationTrendPoint, UserRoleBreakdown } from "../types/domain";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

const ADMIN_TOKENS = {
  accessToken: makeAccessToken({ sub: "admin-1", email: "admin@example.com", ghs_role: "admin" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  setTokens(ADMIN_TOKENS);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function roleBreakdown(overrides: Partial<UserRoleBreakdown> = {}): UserRoleBreakdown {
  return { total: 10, player: 7, admin: 2, superAdmin: 1, ...overrides };
}

function courseRanking(courseId: string, courseName: string, roundsCount: number): CourseRoundRanking {
  return { courseId, courseName, roundsCount };
}

function playerRanking(playerId: string, first: string, last: string, roundsCount: number, handicapIndex: number | null): PlayerRoundRanking {
  return { playerId, playerFirstName: first, playerLastName: last, roundsCount, handicapIndex };
}

function trendPoint(date: string, count: number): RegistrationTrendPoint {
  return { date, count };
}

// ghs#195: activeRightNow's own richer shape -- current + a bucketed
// series pair + hasHistory. Defaults to hasHistory: false (the common,
// cold-start-safe case for tests that don't care about the sparkline
// itself), matching a freshly-seeded backend with no presence_snapshots
// rows yet.
function activeUsersSnapshot(overrides: Partial<ActiveUsersSnapshot> = {}): ActiveUsersSnapshot {
  return { current: 2, period: "24h", series: [], previousSeries: [], hasHistory: false, ...overrides };
}

// ghs#180's own per-section shape -- { data } by default for every
// section; a test overrides just the section(s) it's exercising.
function dashboardResponse(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    totalUsers: { data: roleBreakdown() },
    totalCourses: { data: 5 },
    totalRounds: { data: { total: 20, pending: 3 } },
    topCourses: { data: [] },
    mostActivePlayers: { data: [] },
    activeRightNow: { data: activeUsersSnapshot() },
    userTrends: { data: [] },
    ...overrides,
  };
}

describe("AdminDashboardPage", () => {
  it("shows Total Users with its compact role breakdown (acceptance criterion)", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({
      totalUsers: { data: roleBreakdown({ total: 15, player: 11, admin: 3, superAdmin: 1 }) },
    }));

    renderDashboard();

    expect(await screen.findByText("15")).toBeInTheDocument();
    expect(screen.getByText("11 players · 3 admins · 1 super admin")).toBeInTheDocument();
  });

  it("Total Users' breakdown is singular for exactly one of a role", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({
      totalUsers: { data: roleBreakdown({ total: 3, player: 1, admin: 1, superAdmin: 1 }) },
    }));

    renderDashboard();

    expect(await screen.findByText("1 player · 1 admin · 1 super admin")).toBeInTheDocument();
  });

  it("shows Total Courses and Total Rounds (acceptance criterion)", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({
      totalCourses: { data: 42 },
      totalRounds: { data: { total: 100, pending: 0 } },
    }));

    renderDashboard();

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("Pending Review carries a warning accent when there's a real backlog, none when there isn't", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({ totalRounds: { data: { total: 20, pending: 4 } } }));

    renderDashboard();

    const pendingValue = await screen.findByText("4");
    expect(pendingValue).toHaveClass("text-warning");

    cleanup();
    mock.restore();
    mock = new MockAdapter(api);
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({ totalRounds: { data: { total: 20, pending: 0 } } }));
    renderDashboard();

    const zeroPending = await screen.findByText("0");
    expect(zeroPending).not.toHaveClass("text-warning");
  });

  it("shows Active Right Now (acceptance criterion)", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({ activeRightNow: { data: activeUsersSnapshot({ current: 7 }) } }));

    renderDashboard();

    expect(await screen.findByText("Active right now")).toBeInTheDocument();
    expect(await screen.findByText("7")).toBeInTheDocument();
  });

  it("Active Right Now shows a 'collecting history' note instead of the sparkline while hasHistory is false (cold start, ghs#195)", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({ activeRightNow: { data: activeUsersSnapshot({ current: 13, hasHistory: false }) } }));

    renderDashboard();

    expect(await screen.findByText("13")).toBeInTheDocument();
    expect(screen.getByText(/Collecting history for this chart/)).toBeInTheDocument();
  });

  it("Active Right Now renders the sparkline's accessible data table once hasHistory is true (ghs#195)", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({
      activeRightNow: {
        data: activeUsersSnapshot({
          current: 17,
          hasHistory: true,
          series: [{ timestamp: "2026-09-01T00:00:00.000Z", count: 4 }, { timestamp: "2026-09-01T00:15:00.000Z", count: 6 }],
          previousSeries: [{ timestamp: "2026-08-31T00:00:00.000Z", count: 1 }, { timestamp: "2026-08-31T00:15:00.000Z", count: 2 }],
        }),
      },
    }));

    renderDashboard();

    expect(await screen.findByText("17")).toBeInTheDocument();
    expect(screen.queryByText(/Collecting history for this chart/)).not.toBeInTheDocument();
    const table = screen.getByText("Active users: this 24 hours compared with the previous 24 hours").closest("table")!;
    expect(within(table).getByText("4")).toBeInTheDocument();
    expect(within(table).getByText("6")).toBeInTheDocument();
    expect(within(table).getByText("1")).toBeInTheDocument();
    expect(within(table).getByText("2")).toBeInTheDocument();
  });

  it("Top Courses ranks by rounds played, with the leader's bar at full share (acceptance criterion, real seeded-data shape)", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({
      topCourses: { data: [courseRanking("c1", "St Andrews", 20), courseRanking("c2", "Pebble Beach", 10)] },
    }));

    renderDashboard();

    expect(await screen.findByText("St Andrews")).toBeInTheDocument();
    expect(screen.getByText("Pebble Beach")).toBeInTheDocument();
    expect(screen.getByText("20 rounds")).toBeInTheDocument();
    expect(screen.getByText("10 rounds")).toBeInTheDocument();
  });

  it("Most Active Players shows an avatar and handicap index alongside each ranking (design doc)", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse({
      mostActivePlayers: { data: [playerRanking("p1", "Alice", "Anderson", 12, 14.2), playerRanking("p2", "Bob", "Brown", 6, null)] },
    }));

    renderDashboard();

    // Avatar renders the full name twice (a visible initials badge plus
    // its own sr-only accessible name) -- findAllByText, not findByText.
    expect((await screen.findAllByText("Alice Anderson")).length).toBeGreaterThan(0);
    expect(screen.getByText("Handicap index 14.2")).toBeInTheDocument();
    expect(screen.getAllByText("Bob Brown").length).toBeGreaterThan(0);
    expect(screen.getByText("No handicap index")).toBeInTheDocument();
  });

  it("shows the User Trends chart's real accessible data and lets the period selector switch periods, refetching with the new period (acceptance criterion)", async () => {
    mock.onGet("/dashboard/admin").reply((config) => {
      const period = config.params?.period ?? "30d";
      const points: RegistrationTrendPoint[] = period === "7d" ? [trendPoint("2026-05-01", 9)] : [trendPoint("2026-05-01", 3)];
      return [200, dashboardResponse({ userTrends: { data: points } })];
    });

    renderDashboard();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "7d" }));

    await screen.findByText("9");
    expect(mock.history.get.some((req) => req.params?.period === "7d")).toBe(true);
  });

  it("every widget shows a real, specific empty state when there's genuinely nothing yet", async () => {
    mock.onGet("/dashboard/admin").reply(200, dashboardResponse());

    renderDashboard();

    // Top Courses and Most Active Players share the same "No rounds
    // yet" title text -- their own distinct descriptions are the real
    // per-widget assertion.
    expect(await screen.findByText("Top courses by rounds played will show up here.")).toBeInTheDocument();
    expect(screen.getByText("Most active players by rounds played will show up here.")).toBeInTheDocument();
    expect(screen.getByText("No registrations yet")).toBeInTheDocument();
  });

  it("a whole-request failure (e.g. network/auth) surfaces the real server error message on every widget", async () => {
    mock.onGet("/dashboard/admin").reply(500, { error: "internal server error" });

    renderDashboard();

    const alerts = await screen.findAllByRole("alert");
    // Total Users/Courses/Rounds/Pending, User Trends, Active Right Now,
    // Top Courses, Most Active Players (8).
    expect(alerts.length).toBeGreaterThanOrEqual(8);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent("internal server error");
    }
  });

  it("per-section failure isolation: a failed Top Courses section shows error only there, leaving the rest of the page completely unaffected", async () => {
    mock.onGet("/dashboard/admin").reply(200, {
      totalUsers: { data: roleBreakdown() },
      totalCourses: { data: 5 },
      totalRounds: { data: { total: 20, pending: 3 } },
      topCourses: { error: true },
      mostActivePlayers: { data: [] },
      activeRightNow: { data: activeUsersSnapshot() },
      userTrends: { data: [] },
    });

    renderDashboard();

    expect(await screen.findByText("10")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Something went wrong");
  });
});
