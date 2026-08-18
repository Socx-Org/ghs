import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import PlayerDashboardPage from "./PlayerDashboardPage";
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

const PROFILE = {
  id: "player-1",
  clubId: null,
  firstName: "Ada",
  lastName: "Lovelace",
  country: "GB",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("PlayerDashboardPage", () => {
  it("shows the real handicap index once loaded", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    expect(await screen.findByText("Handicap Index")).toBeInTheDocument();
    expect(await screen.findByText("12.4")).toBeInTheDocument();
  });

  it("shows an eligibility-appropriate empty state when handicapIndex is null (acceptance criterion)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    expect(await screen.findByText("Not yet established")).toBeInTheDocument();
    expect(screen.getByText(/Submit at least 3 rounds/)).toBeInTheDocument();
  });

  it("shows an error state when the profile fails to load", async () => {
    mock.onGet("/players/me").reply(500, { error: "internal server error" });

    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load your handicap index/);
  });

  it("shows recent rounds with a status per row (acceptance criterion)", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/rounds").reply(200, [
      { id: "r1", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-01T09:00:00.000Z", status: "approved" },
      { id: "r2", playerId: "player-1", teeConfigurationId: "t1", playedAt: "2026-05-08T09:00:00.000Z", status: "pending" },
    ]);

    renderDashboard();

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows an empty state when there are no rounds yet", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();

    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
  });

  it("shows an error state when rounds fail to load", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: 12.4, lowHandicapIndex: 10.1 });
    mock.onGet("/players/player-1/rounds").reply(500, { error: "internal server error" });

    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load your rounds/);
  });

  it("signs out via the header button", async () => {
    mock.onGet("/players/me").reply(200, { ...PROFILE, handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderDashboard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    // logout() clears local auth state regardless of network outcome
    // (established behaviour, ghs#63) -- this is the observable proof,
    // not a mocked callback.
    const { getTokens } = await import("../lib/auth-store");
    await waitFor(() => expect(getTokens()).toBeNull());
  });
});
