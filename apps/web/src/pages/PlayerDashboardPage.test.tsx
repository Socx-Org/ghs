import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
import PlayerDashboardPage from "./PlayerDashboardPage";
import { ToastProvider } from "../components";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth-store";
import type { HandicapHistoryRecord, PlayerDashboard, PlayerRoundListItem, PlayerStats } from "../types/domain";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

const PLAYER_TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "player@example.com", ghs_role: "player" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  setTokens(PLAYER_TOKENS);
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
        <PlayerDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ghs#94: through the real AppRoutes, not PlayerDashboardPage in
// isolation, specifically for the two navigation tests below -- real
// end-to-end proof that clicking through actually lands on the right
// screen, not just that the button exists.
function renderDashboardViaRoutes() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function historyRecord(id: string, calculationDate: string, handicapIndex: number): HandicapHistoryRecord {
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

function roundItem(id: string, playedAt: string, status: PlayerRoundListItem["status"]): PlayerRoundListItem {
  return { id, playerId: "player-1", courseId: "c1", courseName: "Sunningdale", teeConfigurationId: "t1", teeConfigurationName: "White", playedAt, status };
}

// A real, internally-consistent stats fixture (roundsCount > 0, so
// statsStatus resolves "ready" by default) -- individual tests override
// only the fields they care about.
function statsFixture(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    roundsCount: 4,
    coursesCount: 2,
    holesCount: 10,
    girPercentage: 40,
    fairwayHitPercentage: 50,
    fairwayMissedLeftPercentage: 25,
    fairwayMissedRightPercentage: 25,
    puttsPerRound: 2.2,
    puttsHolesCount: 10,
    onePuttHoles: 3,
    threePlusPuttHoles: 2,
    penaltiesPerRound: 1.5,
    sandInteractionPercentage: 20,
    ...overrides,
  };
}

// ghs#176's own per-section shape -- { data } by default for every
// section; a test overrides just the section(s) it's exercising.
function dashboardResponse(overrides: Partial<PlayerDashboard> = {}): PlayerDashboard {
  return {
    handicapHistory: { data: [] },
    recentRounds: { data: [] },
    stats: { data: statsFixture() },
    ...overrides,
  };
}

describe("PlayerDashboardPage", () => {
  it("shows the real handicap trend once loaded (acceptance criterion)", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse({
      handicapHistory: { data: [historyRecord("h1", "2026-05-01", 14.2), historyRecord("h2", "2026-06-01", 12.4)] },
    }));

    renderDashboard();

    expect(await screen.findByText("Handicap trend")).toBeInTheDocument();
    expect(await screen.findByText("Current 12.4")).toBeInTheDocument();
  });

  it("shows an eligibility-appropriate empty state when there's no handicap history yet (acceptance criterion)", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse());

    renderDashboard();

    expect(await screen.findByText("Not yet established")).toBeInTheDocument();
    expect(screen.getByText(/Submit at least 3 rounds/)).toBeInTheDocument();
  });

  it("ghs#117: shows a 'not enough history yet' state for exactly one change -- a single point isn't a real trend", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse({
      handicapHistory: { data: [historyRecord("h1", "2026-05-01", 14.2)] },
    }));

    renderDashboard();

    expect(await screen.findByText("Not enough history yet")).toBeInTheDocument();
  });

  it("a whole-request failure (e.g. network/auth) surfaces the real server error message on every widget", async () => {
    mock.onGet("/dashboard/player").reply(500, { error: "internal server error" });

    renderDashboard();

    const alerts = await screen.findAllByRole("alert");
    // Every widget on the page shares this one failure -- Handicap Trend,
    // Recent Rounds, Activity, FIR, Putting, GIR, Sand, Penalties (8).
    expect(alerts.length).toBeGreaterThanOrEqual(8);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent("internal server error");
    }
  });

  it("shows recent rounds with a status per row (acceptance criterion)", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse({
      recentRounds: { data: [roundItem("r1", "2026-05-01T09:00:00.000Z", "approved"), roundItem("r2", "2026-05-08T09:00:00.000Z", "pending")] },
    }));

    renderDashboard();

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("ghs#116: shows only the 3 most recent rounds, via the RecentRoundsWidget's own cap (design doc 9.1)", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse({
      recentRounds: {
        data: [
          roundItem("r1", "2026-05-05T09:00:00.000Z", "approved"),
          roundItem("r2", "2026-05-04T09:00:00.000Z", "approved"),
          roundItem("r3", "2026-05-03T09:00:00.000Z", "approved"),
          roundItem("r4", "2026-05-02T09:00:00.000Z", "approved"),
        ],
      },
    }));

    renderDashboard();

    await screen.findAllByText("Approved");
    expect(screen.getAllByText("Approved")).toHaveLength(3);
  });

  it("shows an empty state on Recent Rounds when there are no rounds yet", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse());

    renderDashboard();

    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
  });

  it("navigates to /rounds/new via the New round button (ghs#94)", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse());

    renderDashboardViaRoutes();
    await waitFor(() => expect(screen.getByRole("button", { name: "New round" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "New round" }));

    expect(await screen.findByRole("heading", { name: "Start a round" })).toBeInTheDocument();
  });

  it("only offers Continue for draft/rejected/amending rounds, navigating to the entry screen (ghs#94)", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse({
      recentRounds: { data: [roundItem("r-draft", "2026-05-01T09:00:00.000Z", "draft"), roundItem("r-approved", "2026-05-02T09:00:00.000Z", "approved")] },
    }));

    renderDashboardViaRoutes();
    await screen.findByText("Draft");
    expect(screen.getByText("Approved")).toBeInTheDocument();

    // Only the draft row gets a Continue action, not the approved one.
    const continueButtons = screen.getAllByRole("button", { name: "Continue" });
    expect(continueButtons).toHaveLength(1);

    await userEvent.click(continueButtons[0]!);
    // Real navigation into RoundEntryPage -- "Back" (BackButton, ghs#134)
    // is its own deterministic, query-independent marker (same as
    // AppRoutes.test.tsx).
    expect(await screen.findByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("ghs#117: the accessible data table alongside the chart reflects the same real values (design doc's 'accessible labels/alternative information')", async () => {
    mock.onGet("/dashboard/player").reply(200, dashboardResponse({
      handicapHistory: { data: [historyRecord("h1", "2026-05-01", 14.2), historyRecord("h2", "2026-06-01", 12.4)] },
    }));

    renderDashboard();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("14.2")).toBeInTheDocument();
    expect(within(table).getByText("12.4")).toBeInTheDocument();
  });

  describe("stats-derived widgets (Activity/FIR/Putting/GIR/Sand/Penalties, ghs#178)", () => {
    it("Activity shows rounds played as the headline and distinct courses as the secondary metric (design doc section B/D)", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({ stats: { data: statsFixture({ roundsCount: 7, coursesCount: 3 }) } }));

      renderDashboard();

      // Widget's own title renders even while loading -- await the real
      // data-dependent value, not just the header, or the assertions
      // below can run before the query has actually resolved.
      expect(await screen.findByText("7")).toBeInTheDocument();
      expect(screen.getByText("Activity")).toBeInTheDocument();
      expect(screen.getByText("3 courses")).toBeInTheDocument();
    });

    it("Activity's secondary metric is singular for exactly one course", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({ stats: { data: statsFixture({ roundsCount: 2, coursesCount: 1 }) } }));

      renderDashboard();

      expect(await screen.findByText("1 course")).toBeInTheDocument();
    });

    it("FIR renders a spatially-ordered segmented bar with real percentages", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({
        stats: { data: statsFixture({ fairwayHitPercentage: 55, fairwayMissedLeftPercentage: 20, fairwayMissedRightPercentage: 25 }) },
      }));

      renderDashboard();

      // Widget's own title renders even while loading -- await the real
      // data-dependent value, not just the header, or the assertions
      // below can run before the query has actually resolved.
      expect(await screen.findByText("55%", { selector: "p" })).toBeInTheDocument();
      expect(screen.getByText("Fairways in regulation")).toBeInTheDocument();
      expect(screen.getByText("Missed left")).toBeInTheDocument();
      expect(screen.getByText("Missed right")).toBeInTheDocument();
    });

    it("Putting shows putts/round as the headline, with 2-putt derived as the remainder (design doc: 'falls out for free')", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({
        // fairwayHitPercentage explicitly moved off its statsFixture
        // default (50) -- FIR renders on the same page from the same
        // stats object, and its own headline/legend would otherwise
        // coincidentally also read "50%", the exact cross-widget
        // fixture collision this comment is here to prevent.
        stats: { data: statsFixture({ holesCount: 10, onePuttHoles: 3, threePlusPuttHoles: 2, puttsPerRound: 2.1, fairwayHitPercentage: 99 }) },
      }));

      renderDashboard();

      expect(await screen.findByText("2.1 putts/round")).toBeInTheDocument();
      expect(screen.getByText("Putting")).toBeInTheDocument();
      // 2-putt = puttsHolesCount(10) - 3 - 2 = 5 holes -> 50%.
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("FIR shows its real empty state when there are approved rounds but no fairway-relevant holes (fairwayHitPercentage null) -- review fix, PR #184", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({
        stats: { data: statsFixture({ fairwayHitPercentage: null, fairwayMissedLeftPercentage: null, fairwayMissedRightPercentage: null }) },
      }));

      renderDashboard();

      expect(await screen.findByText("No fairway data yet")).toBeInTheDocument();
      // Not a broken "ready" render with a "--" headline and an empty bar.
      expect(screen.queryByText("Fairways hit")).not.toBeInTheDocument();
    });

    it("Putting shows its real empty state when there are approved rounds but no putts recorded at all (puttsHolesCount 0) -- review fix, PR #184", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({
        stats: { data: statsFixture({ puttsPerRound: null, puttsHolesCount: 0, onePuttHoles: 0, threePlusPuttHoles: 0 }) },
      }));

      renderDashboard();

      expect(await screen.findByText("No putting data yet")).toBeInTheDocument();
      expect(screen.queryByText("putts/round", { exact: false })).not.toBeInTheDocument();
    });

    it("Putting's segment percentages are computed against puttsHolesCount, not holesCount -- review fix, PR #184 (a round with more holes than putts recorded would otherwise misreport)", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({
        // 18 real holes, but only 10 have putts recorded. If the
        // denominator were holesCount (18), 1-putt would read ~17%
        // instead of the real 30% (3 of 10 putts-holes).
        stats: { data: statsFixture({ holesCount: 18, puttsHolesCount: 10, onePuttHoles: 3, threePlusPuttHoles: 2, puttsPerRound: 2.0, fairwayHitPercentage: 88 }) },
      }));

      renderDashboard();

      expect(await screen.findByText("2 putts/round")).toBeInTheDocument();
      // 1-putt: 3/10 -> 30%. 2-putt (remainder): (10-3-2)/10 -> 50%.
      expect(screen.getByText("30%")).toBeInTheDocument();
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("GIR/Sand/Penalties render their own real percentages/averages, Sand labelled 'Sand interaction' not a shot count (ghs#101)", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({
        stats: { data: statsFixture({ girPercentage: 45, sandInteractionPercentage: 15, penaltiesPerRound: 0.5 }) },
      }));

      renderDashboard();

      expect(await screen.findByText("45%")).toBeInTheDocument();
      // Selector-scoped: KpiStat's own <dt> label duplicates "GIR" as the
      // widget's title, both literally "GIR".
      expect(screen.getByText("GIR", { selector: "h3" })).toBeInTheDocument();
      // "Sand interaction" is the widget title AND the KpiStat label --
      // no collision here since it's a different string from the
      // widget's own h3 (unlike GIR/Penalties, whose title and label are
      // identical).
      expect(screen.getByText("Sand interaction")).toBeInTheDocument();
      expect(screen.getByText("15%")).toBeInTheDocument();
      expect(screen.getByText("Penalties", { selector: "h3" })).toBeInTheDocument();
      expect(screen.getByText("0.5/round")).toBeInTheDocument();
    });

    it("every stats widget shows a real, specific empty state when the player has no approved rounds yet -- not a bare 'No data'", async () => {
      mock.onGet("/dashboard/player").reply(200, dashboardResponse({
        // Real data on the OTHER two sections, so their own genuine
        // empty states don't get mixed into this test's count below --
        // only the six stats-derived widgets should be empty here.
        handicapHistory: { data: [historyRecord("h1", "2026-05-01", 14.2), historyRecord("h2", "2026-06-01", 12.4)] },
        recentRounds: { data: [roundItem("r1", "2026-05-01T09:00:00.000Z", "approved")] },
        stats: { data: statsFixture({ roundsCount: 0 }) },
      }));

      renderDashboard();

      expect(await screen.findByText("Play and get a round approved to see your activity here.")).toBeInTheDocument();
      expect(screen.getByText("No fairway data yet")).toBeInTheDocument();
      expect(screen.getByText("No putting data yet")).toBeInTheDocument();
      // GIR/Sand/Penalties each use EmptyState's compact default (title
      // only); Activity uses the same title text alongside its own
      // longer description above -- 4 occurrences of the shared title,
      // not 3.
      expect(screen.getAllByText("No rounds yet")).toHaveLength(4);
    });

    it("per-section failure isolation, end to end: a failed stats section shows error only on the stats-derived widgets, leaving Handicap Trend and Recent Rounds completely unaffected (ghs#176)", async () => {
      mock.onGet("/dashboard/player").reply(200, {
        handicapHistory: { data: [historyRecord("h1", "2026-05-01", 14.2), historyRecord("h2", "2026-06-01", 12.4)] },
        recentRounds: { data: [roundItem("r1", "2026-05-01T09:00:00.000Z", "approved")] },
        stats: { error: true },
      });

      renderDashboard();

      // The two sections that succeeded render real data, completely
      // unaffected by the stats section's own failure.
      expect(await screen.findByText("Current 12.4")).toBeInTheDocument();
      expect(screen.getByText("Approved")).toBeInTheDocument();

      // The six stats-derived widgets show a real error, not empty/ready
      // content built from data that doesn't exist.
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(6);
      for (const alert of alerts) {
        expect(alert).toHaveTextContent("Something went wrong");
      }
      expect(screen.queryByText("No rounds yet", { exact: false })).not.toBeInTheDocument();
    });

    it("per-section failure isolation, the other direction: a failed handicap-history section doesn't affect the real stats/recent-rounds data", async () => {
      mock.onGet("/dashboard/player").reply(200, {
        handicapHistory: { error: true },
        recentRounds: { data: [roundItem("r1", "2026-05-01T09:00:00.000Z", "approved")] },
        stats: { data: statsFixture({ roundsCount: 3, coursesCount: 2 }) },
      });

      renderDashboard();

      expect(await screen.findByText("Approved")).toBeInTheDocument();
      expect(screen.getByText("Activity")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();

      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent("Something went wrong");
    });
  });
});
