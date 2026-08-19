import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
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

const PROFILE = {
  id: "player-1",
  clubId: null,
  firstName: "Ada",
  lastName: "Lovelace",
  country: "GB",
  createdAt: "2026-01-01T00:00:00.000Z",
  handicapIndex: null,
  lowHandicapIndex: null,
};

const COURSE_SUMMARY = { id: "course-1", clubId: null, name: "Test Links", city: null, country: "GB" };
const COURSE = {
  ...COURSE_SUMMARY,
  teeConfigurations: [
    { id: "tee-1", name: "White", holeCount: 18, courseRating: 71.2, slopeRating: 128, holes: [] },
    { id: "tee-2", name: "Yellow", holeCount: 18, courseRating: 69.0, slopeRating: 120, holes: [] },
  ],
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  setTokens(PLAYER_TOKENS);
  mock.onGet("/players/me").reply(200, PROFILE);
  mock.onGet("/courses").reply(200, [COURSE_SUMMARY]);
  mock.onGet("/courses/course-1").reply(200, COURSE);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderNewRound() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/rounds/new"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NewRoundPage", () => {
  it("shows client-side validation errors without calling the API", async () => {
    renderNewRound();
    await screen.findByRole("heading", { name: "Start a round" });
    await userEvent.click(screen.getByRole("button", { name: "Start round" }));

    expect(await screen.findByText("Choose a course")).toBeInTheDocument();
    expect(screen.getByText("Choose a tee")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("populates the tee select only once a course is chosen", async () => {
    renderNewRound();
    await screen.findByRole("option", { name: "Test Links" });

    const teeSelect = screen.getByLabelText("Tee") as HTMLSelectElement;
    expect(teeSelect).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Course"), "course-1");

    await waitFor(() => expect(teeSelect).not.toBeDisabled());
    expect(screen.getByRole("option", { name: /White/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Yellow/ })).toBeInTheDocument();
  });

  it("creates the round and navigates to its entry screen", async () => {
    const createdRound = {
      id: "round-1", playerId: "player-1", teeConfigurationId: "tee-1", playedAt: "2026-05-01T00:00:00.000Z",
      playingHandicap: null, grossScore: null, adjustedGrossScore: null, scoreDifferential: null, pcc: null,
      totalPutts: null, totalGir: null, totalFairwaysHit: null, totalPenalties: null,
      isTournament: false, is9Hole: false, status: "draft", rejectionReason: null, holeScores: [],
    };
    mock.onPost("/rounds").reply(201, createdRound);
    mock.onGet("/rounds/round-1").reply(200, createdRound);
    mock.onGet("/tee-configurations/tee-1").reply(200, COURSE.teeConfigurations[0]);

    renderNewRound();
    await screen.findByRole("option", { name: "Test Links" });
    await userEvent.selectOptions(screen.getByLabelText("Course"), "course-1");
    await waitFor(() => expect(screen.getByLabelText("Tee")).not.toBeDisabled());
    await userEvent.selectOptions(screen.getByLabelText("Tee"), "tee-1");
    await userEvent.click(screen.getByRole("button", { name: "Start round" }));

    await waitFor(() => expect(mock.history.post?.some((r) => r.url === "/rounds")).toBe(true));
    const body = JSON.parse(mock.history.post!.find((r) => r.url === "/rounds")!.data);
    expect(body).toMatchObject({ playerId: "player-1", teeConfigurationId: "tee-1", isTournament: false, is9Hole: false });
    // The date field defaults to today, unedited -- the sent playedAt
    // must still represent today's real local calendar day once
    // re-read locally, not a day shifted by the timezone bug this PR
    // fixed (review finding, PR #95).
    const sentPlayedAt = new Date(body.playedAt);
    const now = new Date();
    expect(sentPlayedAt.getFullYear()).toBe(now.getFullYear());
    expect(sentPlayedAt.getMonth()).toBe(now.getMonth());
    expect(sentPlayedAt.getDate()).toBe(now.getDate());

    // Navigated to the entry screen for the new round.
    expect(await screen.findByText("Holes recorded")).toBeInTheDocument();
  });

  it("shows a server error without navigating away", async () => {
    mock.onPost("/rounds").reply(400, { error: "playedAt must be a valid date" });

    renderNewRound();
    await screen.findByRole("option", { name: "Test Links" });
    await userEvent.selectOptions(screen.getByLabelText("Course"), "course-1");
    await waitFor(() => expect(screen.getByLabelText("Tee")).not.toBeDisabled());
    await userEvent.selectOptions(screen.getByLabelText("Tee"), "tee-1");
    await userEvent.click(screen.getByRole("button", { name: "Start round" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("playedAt must be a valid date");
    expect(screen.getByRole("heading", { name: "Start a round" })).toBeInTheDocument();
  });

  it("shows real feedback, not a silent no-op, when submitted before the player profile has loaded (review finding, PR #95)", async () => {
    // Never resolves -- simulates "still pending" at submit time.
    mock.onGet("/players/me").reply(() => new Promise(() => {}));

    renderNewRound();
    await screen.findByRole("option", { name: "Test Links" });
    await userEvent.selectOptions(screen.getByLabelText("Course"), "course-1");
    await waitFor(() => expect(screen.getByLabelText("Tee")).not.toBeDisabled());
    await userEvent.selectOptions(screen.getByLabelText("Tee"), "tee-1");
    await userEvent.click(screen.getByRole("button", { name: "Start round" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Still loading your profile/);
    expect(mock.history.post?.filter((r) => r.url === "/rounds")).toHaveLength(0);
  });
});
