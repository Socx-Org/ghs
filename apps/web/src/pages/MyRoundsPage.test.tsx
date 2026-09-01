import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
import { ToastProvider } from "../components";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

function tokensFor(role: string) {
  return {
    accessToken: makeAccessToken({ sub: "caller-1", email: "caller@example.com", ghs_role: role }),
    refreshToken: "refresh-1",
    expiresIn: 900,
  };
}

const PROFILE = {
  id: "player-1", clubId: null, firstName: "Ada", lastName: "Lovelace",
  country: "GB", createdAt: "2026-01-01T00:00:00.000Z", handicapIndex: null, lowHandicapIndex: null,
};

const ROUNDS = [
  {
    id: "round-1", playerId: "player-1", courseId: "course-1", courseName: "Pebble Beach Golf Links",
    teeConfigurationId: "tee-1", teeConfigurationName: "Blue", playedAt: "2026-05-05T00:00:00.000Z", status: "approved",
  },
  {
    id: "round-2", playerId: "player-1", courseId: "course-2", courseName: "St Andrews Links",
    teeConfigurationId: "tee-2", teeConfigurationName: "White", playedAt: "2026-05-01T00:00:00.000Z", status: "draft",
  },
];

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet("/players/me").reply(200, PROFILE);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderAsRole(role: "player" | "admin" = "player") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/rounds"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe("MyRoundsPage", () => {
  it("shows the real rounds for the logged-in player, newest first (backend's own ordering, not re-sorted client-side)", async () => {
    mock.onGet("/players/player-1/rounds").reply(200, ROUNDS);
    renderAsRole("player");

    expect(await screen.findByText("Pebble Beach Golf Links")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    // Scoped to the table -- ghs#137's Status filter dropdown renders its
    // own "Approved"/"Draft" option text, which would otherwise collide.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Approved")).toBeInTheDocument();
    expect(within(table).getByText("Draft")).toBeInTheDocument();
  });

  it("links each row to its own RoundDetailsPage, not the edit screen", async () => {
    mock.onGet("/players/player-1/rounds").reply(200, ROUNDS);
    renderAsRole("player");

    const links = await screen.findAllByRole("link", { name: "Pebble Beach Golf Links" });
    expect(links[0]).toHaveAttribute("href", "/rounds/round-1/details");
  });

  it("offers Edit/Delete only for editable-status rounds, not an approved one", async () => {
    mock.onGet("/players/player-1/rounds").reply(200, ROUNDS);
    renderAsRole("player");

    await screen.findByText("Pebble Beach Golf Links");
    // Exactly one editable round (round-2, draft) -- one Edit, one Delete.
    // ghs#134: row actions are icon-only -- the accessible name names
    // the round's course explicitly instead of relying on visible
    // "Edit"/"Delete" text.
    expect(screen.getAllByRole("button", { name: "Edit round at St Andrews Links" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete round at St Andrews Links" })).toHaveLength(1);
  });

  it("ghs#193: offers Edit but not Delete for a pending round -- a player may correct hole scores while under review, but not delete an already-submitted round", async () => {
    const pendingRound = {
      id: "round-3", playerId: "player-1", courseId: "course-3", courseName: "Carnoustie Golf Links",
      teeConfigurationId: "tee-3", teeConfigurationName: "Championship", playedAt: "2026-05-03T00:00:00.000Z", status: "pending",
    };
    mock.onGet("/players/player-1/rounds").reply(200, [...ROUNDS, pendingRound]);
    renderAsRole("player");

    await screen.findByText("Carnoustie Golf Links");
    expect(screen.getByRole("button", { name: "Edit round at Carnoustie Golf Links" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete round at Carnoustie Golf Links" })).not.toBeInTheDocument();
  });

  it("Edit navigates to the existing edit/resume screen (/rounds/:id)", async () => {
    mock.onGet("/players/player-1/rounds").reply(200, ROUNDS);
    mock.onGet("/rounds/round-2").reply(200, { id: "round-2", playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T00:00:00.000Z", status: "draft", holeScores: [], playingHandicap: null, grossScore: null, adjustedGrossScore: null, scoreDifferential: null, pcc: null, totalPutts: null, totalGir: null, totalFairwaysHit: null, totalPenalties: null, isTournament: false, is9Hole: false, rejectionReason: null });
    mock.onGet("/tee-configurations/tee-1").reply(200, { id: "tee-1", name: "Blue", holeCount: 18, courseRating: 71.2, slopeRating: 128, holes: [] });

    renderAsRole("player");
    await userEvent.click(await screen.findByRole("button", { name: "Edit round at St Andrews Links" }));

    expect(await screen.findByText("Holes recorded")).toBeInTheDocument();
  });

  it("deletes an editable round via a real confirmation Modal and refreshes the list", async () => {
    let deleted = false;
    mock.onGet("/players/player-1/rounds").reply(() => [200, deleted ? [ROUNDS[0]] : ROUNDS]);
    mock.onDelete("/rounds/round-2").reply(() => {
      deleted = true;
      return [200, { round: null, recalculation: null }];
    });

    renderAsRole("player");
    // Scoped to the table, not the Status filter's own "Draft" option
    // (ghs#137), which persists in the DOM regardless of what's deleted.
    const table = await screen.findByRole("table");
    await within(table).findByText("Draft");
    await userEvent.click(screen.getByRole("button", { name: "Delete round at St Andrews Links" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete round" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete round" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Round deleted."));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Draft")).not.toBeInTheDocument());
  });

  it("shows an empty state when there are no rounds yet", async () => {
    mock.onGet("/players/player-1/rounds").reply(200, []);
    renderAsRole("player");

    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    mock.onGet("/players/player-1/rounds").reply(500, { error: "unexpected failure" });
    renderAsRole("player");

    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected failure");
  });

  it("New round navigates to /rounds/new", async () => {
    mock.onGet("/players/player-1/rounds").reply(200, []);
    renderAsRole("player");

    await screen.findByRole("heading", { name: "My Rounds" });
    await userEvent.click(screen.getByRole("button", { name: "New round" }));

    expect(await screen.findByRole("heading", { name: "Start a round" })).toBeInTheDocument();
  });
});
