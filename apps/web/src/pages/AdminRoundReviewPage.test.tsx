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
  id: "tee-1",
  name: "Blue",
  holeCount: 2,
  courseRating: 71.2,
  slopeRating: 128,
  holes: [
    { id: "hole-1", holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 },
    { id: "hole-2", holeNumber: 2, distanceYards: 150, par: 3, strokeIndex: 15 },
  ],
};

const PLAYER = {
  id: "player-1",
  clubId: null,
  firstName: "Alice",
  lastName: "Whitfield",
  country: "US",
  createdAt: "2026-01-01T00:00:00.000Z",
  handicapIndex: 12.4,
  lowHandicapIndex: 10.1,
};

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: "round-1",
    playerId: "player-1",
    teeConfigurationId: "tee-1",
    playedAt: "2026-05-01T00:00:00.000Z",
    playingHandicap: null,
    grossScore: null,
    adjustedGrossScore: null,
    scoreDifferential: null,
    pcc: null,
    totalPutts: null,
    totalGir: null,
    totalFairwaysHit: null,
    totalPenalties: null,
    isTournament: false,
    is9Hole: false,
    status: "pending",
    rejectionReason: null,
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
  mock.onGet("/players/player-1").reply(200, PLAYER);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderAsRole(role: "player" | "admin" = "admin", roundId = "round-1") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/admin/rounds/${roundId}`]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("AdminRoundReviewPage", () => {
  it("redirects a non-admin away", () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound());
    renderAsRole("player");
    expect(screen.queryByRole("heading", { name: "Review round" })).not.toBeInTheDocument();
  });

  it("shows the real player name, tee configuration, and hole-by-hole scores", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound());
    renderAsRole("admin");

    expect(await screen.findByText("Alice Whitfield")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
    expect(screen.getByText("Hit")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument(); // running gross: 5 + 3
  });

  it("shows Approve and Reject actions for a pending round", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    renderAsRole("admin");

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("hides Approve/Reject and shows a notice for a non-pending round", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "approved" }));
    renderAsRole("admin");

    await screen.findByText("Alice Whitfield");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.getByText(/no longer pending/)).toBeInTheDocument();
  });

  it("approves the round, shows a toast, and navigates back to the queue", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    mock.onPatch("/rounds/round-1/status").reply(200, makeRound({ status: "approved" }));
    mock.onGet("/admin/rounds/pending").reply(200, []);

    renderAsRole("admin");
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Round approved."));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Pending rounds" })).toBeInTheDocument());
    const [request] = mock.history.patch ?? [];
    expect(JSON.parse(request.data)).toEqual({ status: "approved" });
  });

  it("disables the Reject confirm button until a non-empty reason is entered", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    renderAsRole("admin");

    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject round" });
    const confirmButton = within(dialog).getByRole("button", { name: "Reject round" });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText("Reason"), "Missing hole 2 score.");
    expect(confirmButton).not.toBeDisabled();
  });

  it("rejects the round with the entered reason, shows a toast, and navigates back to the queue", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    mock.onPatch("/rounds/round-1/status").reply(200, makeRound({ status: "rejected", rejectionReason: "Missing hole 2 score." }));
    mock.onGet("/admin/rounds/pending").reply(200, []);

    renderAsRole("admin");
    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject round" });
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Missing hole 2 score.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject round" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Round rejected."));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Pending rounds" })).toBeInTheDocument());
    const [request] = mock.history.patch ?? [];
    expect(JSON.parse(request.data)).toEqual({ status: "rejected", rejectionReason: "Missing hole 2 score." });
  });

  // Proactive fix mirroring the review finding on #112 (PR #136) --
  // typed-but-cancelled state must not survive a reopen.
  it("resets the reason field when the Reject modal is reopened after Cancel", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    renderAsRole("admin");

    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));
    let dialog = await screen.findByRole("dialog", { name: "Reject round" });
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Stale draft reason");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    dialog = await screen.findByRole("dialog", { name: "Reject round" });
    expect(within(dialog).getByLabelText("Reason")).toHaveValue("");
  });

  // Review finding (PR #139): a failed player re-fetch used to fall back
  // silently to the generic "Player" label, hiding the load failure and
  // making the screen look partially broken with no indication anything
  // went wrong. The round/tee data and Approve/Reject actions must still
  // work -- only the player's name is affected.
  it("surfaces a failed player fetch instead of silently falling back to a generic label", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    mock.onGet("/players/player-1").reply(500);

    renderAsRole("admin");

    expect(await screen.findByText("Couldn't load player name")).toBeInTheDocument();
    expect(screen.queryByText("Player")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("shows the server's error message on a failed approve, without navigating away", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));
    mock.onPatch("/rounds/round-1/status").reply(409, { error: "round is not in a state that allows approval" });

    renderAsRole("admin");
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("round is not in a state that allows approval"));
    expect(screen.getByRole("heading", { name: "Review round" })).toBeInTheDocument();
  });
});
