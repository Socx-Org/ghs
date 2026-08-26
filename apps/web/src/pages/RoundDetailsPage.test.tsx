import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
import { ToastProvider } from "../components";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth-store";
import type { Round } from "../types/domain";

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

const TEE_CONFIGURATION = {
  id: "tee-1", name: "Blue", holeCount: 2, courseRating: 71.2, slopeRating: 128,
  holes: [
    { id: "hole-1", holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 },
    { id: "hole-2", holeNumber: 2, distanceYards: 150, par: 3, strokeIndex: 15 },
  ],
};

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: "round-1", playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T00:00:00.000Z",
    playingHandicap: null, grossScore: null, adjustedGrossScore: null, scoreDifferential: null, pcc: null,
    totalPutts: null, totalGir: null, totalFairwaysHit: null, totalPenalties: null,
    isTournament: false, is9Hole: false, status: "approved", rejectionReason: null,
    holeScores: [
      { id: "hs-1", holeNumber: 1, strokes: 5, putts: 2, gir: false, fairwayResult: "hit", inSand: false, penalties: 0, netDoubleBogeyAdjusted: 5 },
      { id: "hs-2", holeNumber: 2, strokes: 3, putts: 1, gir: true, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 3 },
    ],
    ...overrides,
  };
}

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet("/tee-configurations/tee-1").reply(200, TEE_CONFIGURATION);
  // Supplementary to every test below (review finding, PR #148: the
  // course name comes from here, not GET /rounds/:id or
  // GET /tee-configurations/:id, neither of which has it).
  mock.onGet("/players/player-1/rounds").reply(200, [
    { id: "round-1", playerId: "player-1", courseId: "course-1", courseName: "Pebble Beach Golf Links", teeConfigurationId: "tee-1", teeConfigurationName: "Blue", playedAt: "2026-05-01T00:00:00.000Z", status: "approved" },
  ]);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderAsRole(role: "player" | "admin" = "player", roundId = "round-1") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/rounds/${roundId}/details`]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("RoundDetailsPage", () => {
  it("shows the real course, tee configuration, status, and hole-by-hole scores for an approved round", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "approved", grossScore: 88, scoreDifferential: 14.2 }));
    renderAsRole("player");

    // Course name (review finding, PR #148) -- sourced from
    // GET /players/:playerId/rounds, not GET /rounds/:id or
    // GET /tee-configurations/:id, neither of which has it.
    expect(await screen.findByRole("heading", { name: "Pebble Beach Golf Links" })).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("14.2")).toBeInTheDocument();
    expect(screen.getByText("Hit")).toBeInTheDocument();
  });

  it("shows the rejection reason for a rejected round", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "rejected", rejectionReason: "Hole 2 looks wrong." }));
    renderAsRole("player");

    expect(await screen.findByText("This round was rejected")).toBeInTheDocument();
    expect(screen.getByText("Hole 2 looks wrong.")).toBeInTheDocument();
  });

  it("offers an Edit round action for an editable-status round", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "draft" }));
    renderAsRole("player");

    expect(await screen.findByRole("button", { name: "Edit round" })).toBeInTheDocument();
  });

  it("offers no Edit action for a non-editable (approved/pending) round", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "approved" }));
    renderAsRole("player");

    await screen.findByText("Blue");
    expect(screen.queryByRole("button", { name: "Edit round" })).not.toBeInTheDocument();
  });

  it("Edit round navigates to the existing edit/resume screen", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "draft" }));
    renderAsRole("player");

    await userEvent.click(await screen.findByRole("button", { name: "Edit round" }));
    expect(await screen.findByText("Holes recorded")).toBeInTheDocument();
  });

  // ghs#169: the real gap this issue closes -- a pending round is never
  // reached through RoundEntryPage at all (it renders a plain
  // "already submitted" card there), so this screen is the only place
  // its played date can ever be edited.
  it("offers Edit date for a pending round, even though it offers no Edit round action at all for one", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    renderAsRole("player");

    await screen.findByText("Blue");
    expect(screen.getByRole("button", { name: "Edit date" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit round" })).not.toBeInTheDocument();
  });

  it("offers no Edit date action once a round is approved", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "approved" }));
    renderAsRole("player");

    await screen.findByText("Blue");
    expect(screen.queryByRole("button", { name: "Edit date" })).not.toBeInTheDocument();
  });

  it("changes a pending round's played date and reflects it after refetch", async () => {
    const round = makeRound({ status: "pending", playedAt: "2026-05-01T12:00:00.000Z" });
    mock.onGet("/rounds/round-1").reply(() => [200, round]);
    mock.onPatch("/rounds/round-1/played-at").reply((config) => {
      const body = JSON.parse(config.data);
      round.playedAt = body.playedAt;
      return [200, { round }];
    });
    renderAsRole("player");

    await screen.findByText("Blue");
    expect(screen.getByText("May 1, 2026")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit date" }));
    const input = await screen.findByLabelText("Date played");
    await userEvent.clear(input);
    await userEvent.type(input, "2026-06-15");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Jun 15, 2026");
  });

  it("shows the real error message when the round fails to load", async () => {
    mock.onGet("/rounds/round-1").reply(404, { error: "round not found" });
    renderAsRole("player");

    expect(await screen.findByRole("alert")).toHaveTextContent("round not found");
  });

  it("Back navigates to My Rounds", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound());
    mock.onGet("/players/me").reply(200, { id: "player-1", clubId: null, firstName: "A", lastName: "B", country: "GB", createdAt: "2026-01-01T00:00:00.000Z", handicapIndex: null, lowHandicapIndex: null });

    renderAsRole("player");
    await screen.findByText("Blue");
    await userEvent.click(screen.getByRole("button", { name: "Back to My Rounds" }));

    expect(await screen.findByRole("heading", { name: "My Rounds" })).toBeInTheDocument();
  });
});
