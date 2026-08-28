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

const PROFILE = {
  id: "player-1",
  clubId: null,
  firstName: "Ada",
  lastName: "Lovelace",
  country: "GB",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function historyRecord(id: string, calculationDate: string, handicapIndex: number) {
  return {
    id,
    playerId: "player-1",
    method: "calculated" as const,
    handicapIndex,
    previousIndex: null,
    reason: null,
    createdBy: null,
    calculationSnapshot: null,
    calculationDate,
    createdAt: calculationDate,
  };
}

describe("PlayerDashboardPage", () => {
  it("shows the real handicap trend once loaded (acceptance criterion)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/handicap-history").reply(200, [
      historyRecord("h1", "2026-05-01", 14.2),
      historyRecord("h2", "2026-06-01", 12.4),
    ]);
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    expect(await screen.findByText("Handicap trend")).toBeInTheDocument();
    expect(await screen.findByText("Current 12.4")).toBeInTheDocument();
  });

  it("shows an eligibility-appropriate empty state when there's no handicap history yet (acceptance criterion)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/handicap-history").reply(200, []);
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    expect(await screen.findByText("Not yet established")).toBeInTheDocument();
    expect(screen.getByText(/Submit at least 3 rounds/)).toBeInTheDocument();
  });

  it("ghs#117: shows a 'not enough history yet' state for exactly one change -- a single point isn't a real trend", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 14.2, lowHandicapIndex: 14.2 });
    mock.onGet("/players/player-1/handicap-history").reply(200, [historyRecord("h1", "2026-05-01", 14.2)]);
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    expect(await screen.findByText("Not enough history yet")).toBeInTheDocument();
  });

  it("shows an error state when the profile fails to load", async () => {
    mock.onGet("/players/me").reply(500, { error: "internal server error" });

    renderDashboard();

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("internal server error");
  });

  it("surfaces the real server error message, e.g. the 404 for an account with no linked player row (review finding, PR #91)", async () => {
    mock.onGet("/players/me").reply(404, { error: "no player profile linked to this account" });

    renderDashboard();

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("no player profile linked to this account");
  });

  it("does not get stuck showing skeletons forever when the profile fails to load (review finding, PR #91)", async () => {
    mock.onGet("/players/me").reply(404, { error: "no player profile linked to this account" });

    renderDashboard();

    await screen.findByRole("alert");
    // A disabled query (no playerId to fetch with) never leaves TanStack
    // Query's "pending" status on its own -- rendering that as a loading
    // skeleton would show it forever. Neither widget's body renders
    // loading/empty content here, and no request for history or rounds
    // is ever made.
    expect(screen.queryByText("No rounds yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Not yet established")).not.toBeInTheDocument();
    expect(mock.history.get?.some((r) => r.url?.includes("/rounds"))).toBe(false);
    expect(mock.history.get?.some((r) => r.url?.includes("/handicap-history"))).toBe(false);
    // Review finding, PR #173: RecentRoundsWidget's header/actions must
    // still render even though its body is idle. HandicapTrendWidget,
    // unlike RecentRoundsWidget, has no header action to preserve --
    // its own real error IS the one alert asserted above (there's no
    // longer a separate surface for a profile failure to hide behind).
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New round" })).toBeInTheDocument();
  });

  it("shows recent rounds with a status per row (acceptance criterion)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/handicap-history").reply(200, []);
    mock.onGet("/players/player-1/rounds").reply(200, [
      { id: "r1", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-01T09:00:00.000Z", status: "approved" },
      { id: "r2", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-08T09:00:00.000Z", status: "pending" },
    ]);

    renderDashboard();

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("ghs#116: shows only the 3 most recent rounds, via the RecentRoundsWidget's own cap (design doc 9.1)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/handicap-history").reply(200, []);
    mock.onGet("/players/player-1/rounds").reply(200, [
      { id: "r1", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-05T09:00:00.000Z", status: "approved" },
      { id: "r2", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-04T09:00:00.000Z", status: "approved" },
      { id: "r3", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-03T09:00:00.000Z", status: "approved" },
      { id: "r4", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-02T09:00:00.000Z", status: "approved" },
    ]);

    renderDashboard();

    await screen.findAllByText("Approved");
    expect(screen.getAllByText("Approved")).toHaveLength(3);
  });

  it("shows an empty state when there are no rounds yet", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/handicap-history").reply(200, []);
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
  });

  it("shows an error state when rounds fail to load", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/handicap-history").reply(200, []);
    mock.onGet("/players/player-1/rounds").reply(500, { error: "internal server error" });

    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent("internal server error");
  });

  it("navigates to /rounds/new via the New round button (ghs#94)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/handicap-history").reply(200, []);
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboardViaRoutes();
    await waitFor(() => expect(screen.getByRole("button", { name: "New round" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "New round" }));

    expect(await screen.findByRole("heading", { name: "Start a round" })).toBeInTheDocument();
  });

  it("only offers Continue for draft/rejected/amending rounds, navigating to the entry screen (ghs#94)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/handicap-history").reply(200, []);
    mock.onGet("/players/player-1/rounds").reply(200, [
      { id: "r-draft", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-01T09:00:00.000Z", status: "draft" },
      { id: "r-approved", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-02T09:00:00.000Z", status: "approved" },
    ]);

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
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/handicap-history").reply(200, [
      historyRecord("h1", "2026-05-01", 14.2),
      historyRecord("h2", "2026-06-01", 12.4),
    ]);
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("14.2")).toBeInTheDocument();
    expect(within(table).getByText("12.4")).toBeInTheDocument();
  });
});
