import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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

const PLAYER_TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "player@example.com", ghs_role: "player" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

const TEE_CONFIGURATION = {
  id: "tee-1",
  name: "White",
  holeCount: 2,
  courseRating: 68.0,
  slopeRating: 113,
  holes: [
    { id: "hole-1", holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 1 },
    { id: "hole-2", holeNumber: 2, distanceYards: 150, par: 3, strokeIndex: 2 },
  ],
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
    status: "draft",
    rejectionReason: null,
    holeScores: [],
    ...overrides,
  };
}

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  setTokens(PLAYER_TOKENS);
  mock.onGet("/tee-configurations/tee-1").reply(200, TEE_CONFIGURATION);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderEntry(path = "/rounds/round-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("RoundEntryPage", () => {
  it("renders one card per hole in the tee configuration, with progress reflecting existing scores", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({
      holeScores: [{ id: "hs-1", holeNumber: 1, strokes: 4, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 4 }],
    }));

    renderEntry();

    expect(await screen.findByText("White")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("Par 4 · Stroke index 1")).toBeInTheDocument();
    expect(screen.getByText("Par 3 · Stroke index 2")).toBeInTheDocument();
    // Hole 1 has an existing score -- shown as saved.
    expect(screen.getAllByText("Saved")).toHaveLength(1);
  });

  it("disables submit until every required hole has a score, then allows it", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({
      holeScores: [{ id: "hs-1", holeNumber: 1, strokes: 4, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 4 }],
    }));

    renderEntry();
    await screen.findByText("White");

    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
    expect(screen.getByText(/Record 1 more hole/)).toBeInTheDocument();
  });

  it("saves a hole's strokes and reflects it after refetch", async () => {
    const round = makeRound();
    mock.onGet("/rounds/round-1").reply(() => [200, round]);
    mock.onPost("/rounds/round-1/holes").reply((config) => {
      const body = JSON.parse(config.data);
      round.holeScores.push({ id: "hs-new", holeNumber: body.holeNumber, strokes: body.strokes, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: body.strokes });
      return [200, round.holeScores[round.holeScores.length - 1]];
    });

    renderEntry();
    await screen.findByText("White");

    const holeOneCard = screen.getByText("Par 4 · Stroke index 1").closest<HTMLElement>("div.rounded-lg")!;
    await userEvent.type(within(holeOneCard).getByLabelText("Strokes"), "5");
    await userEvent.click(within(holeOneCard).getByRole("button", { name: "Save hole" }));

    await waitFor(() => expect(mock.history.post?.length).toBe(1));
    const body = JSON.parse(mock.history.post![0]!.data);
    expect(body).toMatchObject({ holeNumber: 1, strokes: 5 });

    // The round query is invalidated and refetched -- the progress
    // stat now reflects the real persisted state.
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
  });

  it("submits a complete round and navigates back to the dashboard", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({
      holeScores: [
        { id: "hs-1", holeNumber: 1, strokes: 4, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 4 },
        { id: "hs-2", holeNumber: 2, strokes: 3, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 3 },
      ],
    }));
    mock.onPost("/rounds/round-1/submit").reply(200, { round: makeRound({ status: "pending" }), recalculation: null });
    mock.onGet("/players/me").reply(200, { id: "player-1", clubId: null, firstName: "A", lastName: "B", country: "GB", createdAt: "2026-01-01T00:00:00.000Z", handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderEntry();
    await screen.findByText("White");

    const submitButton = screen.getByRole("button", { name: "Submit for review" });
    expect(submitButton).not.toBeDisabled();
    await userEvent.click(submitButton);

    // Navigated back to "/" -- the player dashboard renders for a player.
    await waitFor(() => expect(screen.getByText("Recent rounds")).toBeInTheDocument());
    // ghs#114: a normal (still-pending) submission gets its own real
    // confirmation, distinct from the auto-approval message below --
    // there was no confirmation message at all here before this issue.
    expect(screen.getByRole("status")).toHaveTextContent("Submitted for review.");
  });

  // ghs#114: an admin-created round auto-approves on submit (#100)
  // instead of entering the pending queue -- RoundEntryPage is reused
  // unchanged for this (design doc's own "reuse established round-
  // entry components" principle), but the confirmation message must
  // reflect the real outcome the backend actually reports (round.status
  // in the /submit response), not assume "submitted for review" always.
  it("shows a distinct confirmation when the backend reports the round as auto-approved, not the ordinary submitted-for-review message", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({
      holeScores: [
        { id: "hs-1", holeNumber: 1, strokes: 4, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 4 },
        { id: "hs-2", holeNumber: 2, strokes: 3, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 3 },
      ],
    }));
    mock.onPost("/rounds/round-1/submit").reply(200, { round: makeRound({ status: "approved" }), recalculation: { playerId: "player-1", trigger: "round_approved", status: "eligible", handicapIndex: 12.3 } });
    mock.onGet("/players/me").reply(200, { id: "player-1", clubId: null, firstName: "A", lastName: "B", country: "GB", createdAt: "2026-01-01T00:00:00.000Z", handicapIndex: null, lowHandicapIndex: null });
    mock.onGet("/players/player-1/rounds").reply(200, []);

    renderEntry();
    await screen.findByText("White");
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => expect(screen.getByText("Recent rounds")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Round approved automatically.");
  });

  it("surfaces the real 409 message if submit is rejected as incomplete", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({
      holeScores: [
        { id: "hs-1", holeNumber: 1, strokes: 4, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 4 },
        { id: "hs-2", holeNumber: 2, strokes: 3, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 3 },
      ],
    }));
    mock.onPost("/rounds/round-1/submit").reply(409, { error: "round has 1 of 2 required hole scores recorded" });

    renderEntry();
    await screen.findByText("White");
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("round has 1 of 2 required hole scores recorded");
  });

  it("shows a read-only state for an already-submitted round, no hole cards", async () => {
    mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "pending" }));

    renderEntry();

    expect(await screen.findByText(/already been submitted/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Strokes")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
  });

  // ghs#68: the real gap this issue closes -- a rejected round
  // previously went straight into this same entry form with zero
  // indication it had been rejected, or why.
  describe("rejection reason", () => {
    it("shows the status badge and the real rejection reason prominently for a rejected round", async () => {
      mock.onGet("/rounds/round-1").reply(200, makeRound({
        status: "rejected",
        rejectionReason: "Hole 2's stroke count looks wrong -- please double check.",
      }));

      renderEntry();

      expect(await screen.findByText("Rejected")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Hole 2's stroke count looks wrong -- please double check.");
      // Still editable -- the hole-entry form renders underneath, same
      // as any other editable status.
      expect(screen.getAllByLabelText("Strokes").length).toBeGreaterThan(0);
    });

    it("shows no rejection alert for a draft round (nothing to show)", async () => {
      mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "draft" }));

      renderEntry();
      await screen.findByText("Draft");

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the status badge but no rejection alert for an amending round -- no reason exists to show (confirmed directly: reopenForAmendment never persists its reason on the round)", async () => {
      mock.onGet("/rounds/round-1").reply(200, makeRound({ status: "amending", rejectionReason: null }));

      renderEntry();

      expect(await screen.findByText("Amending")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("edits and resubmits a rejected round, landing back in pending for real", async () => {
      const round = makeRound({
        status: "rejected",
        rejectionReason: "Hole 2's stroke count looks wrong -- please double check.",
        holeScores: [
          { id: "hs-1", holeNumber: 1, strokes: 4, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 4 },
          { id: "hs-2", holeNumber: 2, strokes: 3, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 3 },
        ],
      });
      mock.onGet("/rounds/round-1").reply(() => [200, round]);
      mock.onPost("/rounds/round-1/holes").reply((config) => {
        const body = JSON.parse(config.data);
        const hole = round.holeScores.find((h) => h.holeNumber === body.holeNumber)!;
        hole.strokes = body.strokes;
        hole.netDoubleBogeyAdjusted = body.strokes;
        return [200, hole];
      });
      mock.onPost("/rounds/round-1/submit").reply(200, { round: makeRound({ status: "pending" }), recalculation: null });
      mock.onGet("/players/me").reply(200, { id: "player-1", clubId: null, firstName: "A", lastName: "B", country: "GB", createdAt: "2026-01-01T00:00:00.000Z", handicapIndex: null, lowHandicapIndex: null });
      mock.onGet("/players/player-1/rounds").reply(200, []);

      renderEntry();
      await screen.findByRole("alert");

      // The actual correction the rejection reason asks for -- hole 2's
      // stroke count, 3 -> 4 -- via the real hole-entry form, not a
      // pre-seeded fixture. Proves this is a genuine edit-then-resubmit
      // loop, not just a resubmit of unchanged data.
      const holeTwoCard = screen.getByText("Par 3 · Stroke index 2").closest<HTMLElement>("div.rounded-lg")!;
      const strokesInput = within(holeTwoCard).getByLabelText("Strokes");
      await userEvent.clear(strokesInput);
      await userEvent.type(strokesInput, "4");
      await userEvent.click(within(holeTwoCard).getByRole("button", { name: "Save hole" }));

      await waitFor(() => expect(mock.history.post?.some((r) => r.url === "/rounds/round-1/holes")).toBe(true));
      const holeBody = JSON.parse(mock.history.post!.find((r) => r.url === "/rounds/round-1/holes")!.data);
      expect(holeBody).toMatchObject({ holeNumber: 2, strokes: 4 });

      const submitButton = await screen.findByRole("button", { name: "Submit for review" });
      expect(submitButton).not.toBeDisabled();
      await userEvent.click(submitButton);

      await waitFor(() => expect(screen.getByText("Recent rounds")).toBeInTheDocument());
      expect(mock.history.post!.some((r) => r.url === "/rounds/round-1/submit")).toBe(true);
    });
  });
});
