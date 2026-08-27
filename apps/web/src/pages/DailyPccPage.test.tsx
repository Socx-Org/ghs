import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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

const ADMIN_TOKENS = {
  accessToken: makeAccessToken({ sub: "admin-1", email: "admin@example.com", ghs_role: "admin" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

const COURSE_SUMMARY = { id: "course-1", clubId: null, name: "Pebble Beach Golf Links", city: null, country: "US" };
const COURSE = {
  ...COURSE_SUMMARY,
  teeConfigurations: [{ id: "tee-1", name: "Blue", holeCount: 18, courseRating: 74.5, slopeRating: 136, holes: [] }],
};

const DAILY_PCC = {
  id: "daily-pcc-1",
  teeConfigurationId: "tee-1",
  playedOn: "2026-05-01",
  pcc: 0,
  source: "calculated" as const,
  updatedBy: null,
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const ROUNDS_RESULT = {
  items: [
    {
      id: "round-1",
      playerId: "player-1",
      playerFirstName: "Browser",
      playerLastName: "Player",
      courseId: "course-1",
      courseName: "Pebble Beach Golf Links",
      teeConfigurationId: "tee-1",
      teeConfigurationName: "Blue",
      playedAt: "2026-05-01T09:00:00.000Z",
      status: "pending",
      grossScore: 90,
      adjustedGrossScore: 88,
      scoreDifferential: 18.4,
      pcc: 0,
    },
  ],
  total: 1,
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  setTokens(ADMIN_TOKENS);
  mock.onGet("/courses").reply(200, [COURSE_SUMMARY]);
  mock.onGet("/courses/course-1").reply(200, COURSE);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/pcc"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function selectTeeAndDate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: "Pebble Beach Golf Links" });
  await user.selectOptions(screen.getByLabelText("Course"), "course-1");
  await waitFor(() => expect(screen.getByLabelText("Tee")).not.toBeDisabled());
  await user.selectOptions(screen.getByLabelText("Tee"), "tee-1");
  const dateInput = screen.getByLabelText("Date played");
  await user.clear(dateInput);
  await user.type(dateInput, "2026-05-01");
}

describe("DailyPccPage", () => {
  it("ghs#168: shows a tee/day's real submitted scores before any round is approved, and the current PCC", async () => {
    mock.onGet("/admin/tee-configurations/tee-1/pcc", { params: { playedOn: "2026-05-01" } }).reply(200, { dailyPcc: DAILY_PCC });
    mock.onGet("/admin/rounds", { params: { teeConfigurationId: "tee-1", playedOn: "2026-05-01" } }).reply(200, ROUNDS_RESULT);
    const user = userEvent.setup();
    renderPage();

    await selectTeeAndDate(user);

    expect(await screen.findByText("Browser Player")).toBeInTheDocument();
    // The round is still 'pending', but ghs#168's own point is that it
    // already has a real score -- this admin screen must show it (unlike
    // RoundDetailsPage's player-facing withholding).
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("18.4")).toBeInTheDocument();
    expect(screen.getByText("Current PCC")).toBeInTheDocument();
    expect(screen.getByText("Calculated from rounds")).toBeInTheDocument();
  });

  it("shows an empty state when no rounds exist yet for the chosen tee/day", async () => {
    mock.onGet("/admin/tee-configurations/tee-1/pcc", { params: { playedOn: "2026-05-01" } }).reply(200, { dailyPcc: DAILY_PCC });
    mock.onGet("/admin/rounds", { params: { teeConfigurationId: "tee-1", playedOn: "2026-05-01" } }).reply(200, { items: [], total: 0 });
    const user = userEvent.setup();
    renderPage();

    await selectTeeAndDate(user);

    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
  });

  it("ghs#168: applying an override calls the PATCH endpoint and surfaces the real recalculation outcome", async () => {
    mock.onGet("/admin/tee-configurations/tee-1/pcc", { params: { playedOn: "2026-05-01" } }).reply(200, { dailyPcc: DAILY_PCC });
    mock.onGet("/admin/rounds", { params: { teeConfigurationId: "tee-1", playedOn: "2026-05-01" } }).reply(200, ROUNDS_RESULT);
    mock.onPatch("/admin/tee-configurations/tee-1/pcc").reply(200, {
      dailyPcc: { ...DAILY_PCC, pcc: 2, source: "override" },
      updatedRounds: 1,
      playerRecalculations: [{ playerId: "player-1", trigger: "pcc_correction", status: "insufficient_rounds" }],
    });
    const user = userEvent.setup();
    renderPage();

    await selectTeeAndDate(user);
    await screen.findByText("Browser Player");

    await user.selectOptions(screen.getByRole("combobox", { name: "Override PCC" }), "+2");
    await user.click(screen.getByRole("button", { name: "Apply override" }));

    await waitFor(() => {
      expect(mock.history.patch).toHaveLength(1);
    });
    expect(JSON.parse(mock.history.patch[0]!.data)).toEqual({ playedOn: "2026-05-01", pcc: 2 });
    expect(await screen.findByText(/PCC set to 2 \(override\)\. 1 round updated, 1 player recalculated\./)).toBeInTheDocument();
  });

  it("Recalculate from rounds sends a null override, accepting the calculated value", async () => {
    mock.onGet("/admin/tee-configurations/tee-1/pcc", { params: { playedOn: "2026-05-01" } }).reply(200, { dailyPcc: DAILY_PCC });
    mock.onGet("/admin/rounds", { params: { teeConfigurationId: "tee-1", playedOn: "2026-05-01" } }).reply(200, ROUNDS_RESULT);
    mock.onPatch("/admin/tee-configurations/tee-1/pcc").reply(200, {
      dailyPcc: DAILY_PCC,
      updatedRounds: 1,
      playerRecalculations: [{ playerId: "player-1", trigger: "pcc_correction", status: "insufficient_rounds" }],
    });
    const user = userEvent.setup();
    renderPage();

    await selectTeeAndDate(user);
    await screen.findByText("Browser Player");

    await user.click(screen.getByRole("button", { name: "Recalculate from rounds" }));

    await waitFor(() => {
      expect(mock.history.patch).toHaveLength(1);
    });
    expect(JSON.parse(mock.history.patch[0]!.data)).toEqual({ playedOn: "2026-05-01", pcc: null });
  });
});
