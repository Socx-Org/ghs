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

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderAsRole(role: "player" | "admin" = "admin") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/rounds"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

const ROUNDS = {
  items: [
    {
      id: "round-1",
      playerId: "player-1",
      playerFirstName: "Alice",
      playerLastName: "Whitfield",
      courseId: "course-1",
      courseName: "Pebble Beach Golf Links",
      teeConfigurationId: "tee-1",
      teeConfigurationName: "Blue",
      playedAt: "2026-05-01T00:00:00.000Z",
      status: "approved",
    },
    {
      id: "round-2",
      playerId: "player-2",
      playerFirstName: "Bob",
      playerLastName: "Carver",
      courseId: "course-1",
      courseName: "Pebble Beach Golf Links",
      teeConfigurationId: "tee-1",
      teeConfigurationName: "Blue",
      playedAt: "2026-05-02T00:00:00.000Z",
      status: "pending",
    },
  ],
  total: 2,
};

describe("AdminRoundsListPage", () => {
  it("redirects a non-admin away", () => {
    renderAsRole("player");
    expect(screen.queryByRole("heading", { name: "All rounds" })).not.toBeInTheDocument();
  });

  it("shows rounds across multiple players and statuses for an admin", async () => {
    mock.onGet("/admin/rounds").reply(200, ROUNDS);
    renderAsRole("admin");

    expect(await screen.findByText("Alice Whitfield")).toBeInTheDocument();
    expect(screen.getByText("Bob Carver")).toBeInTheDocument();
    // Scoped to the table -- ghs#137's Status filter dropdown renders its
    // own "Approved"/"Pending" option text, which would otherwise collide.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Approved")).toBeInTheDocument();
    expect(within(table).getByText("Pending")).toBeInTheDocument();
  });

  it("links each row to its round-review screen", async () => {
    mock.onGet("/admin/rounds").reply(200, ROUNDS);
    renderAsRole("admin");

    const link = await screen.findByRole("link", { name: "Alice Whitfield" });
    expect(link).toHaveAttribute("href", "/admin/rounds/round-1");
  });

  it("shows an empty state when there are no rounds at all", async () => {
    mock.onGet("/admin/rounds").reply(200, { items: [], total: 0 });
    renderAsRole("admin");

    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    mock.onGet("/admin/rounds").reply(500, { error: "unexpected failure" });
    renderAsRole("admin");

    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected failure");
  });

  // ghs#115: a per-row delete action, real confirmation Modal.
  describe("delete", () => {
    it("deletes the round, shows a toast reflecting the real recalculation outcome, and genuinely refetches the list (the deleted round disappears)", async () => {
      // A real, mutable mock reply, not a single fixed one -- proves
      // the list genuinely refetches after delete (review finding, PR
      // #145), not just that the toast/modal state changed locally.
      // Before the deletion, the reply includes round-1; after, it
      // doesn't -- if invalidateQueries never actually re-ran the
      // query, the stale first reply's row would still be showing.
      let deleted = false;
      mock.onGet("/admin/rounds").reply(() => [200, deleted ? { items: ROUNDS.items.slice(1), total: 1 } : ROUNDS]);
      mock.onDelete("/rounds/round-1").reply(() => {
        deleted = true;
        return [200, { round: null, recalculation: { playerId: "player-1", trigger: "round_deleted", status: "eligible", handicapIndex: 11.9 } }];
      });

      renderAsRole("admin");
      await screen.findByText("Alice Whitfield");
      const [firstDeleteButton] = await screen.findAllByRole("button", { name: "Delete" });
      await userEvent.click(firstDeleteButton!);

      const dialog = await screen.findByRole("dialog", { name: "Delete round" });
      expect(dialog).toHaveTextContent("Alice Whitfield");
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete round" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The player's handicap has been recalculated."));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // The list genuinely refetched -- round-1's own row (Alice
      // Whitfield) is gone, round-2's (Bob Carver) is still there.
      await waitFor(() => expect(screen.queryByText("Alice Whitfield")).not.toBeInTheDocument());
      expect(screen.getByText("Bob Carver")).toBeInTheDocument();
      expect(mock.history.get?.filter((r) => r.url === "/admin/rounds").length).toBeGreaterThanOrEqual(2);
    });

    // Review finding, PR #145: the app-wide QueryClient (App.tsx) caches
    // across routes -- deleting a round here must not leave its own
    // ["rounds", id] entry cached and stale (e.g. from an earlier visit
    // to its review screen), or navigating back to it later could
    // briefly show stale "still exists" data before the 404 refetch.
    it("removes the deleted round's own cached query, not just the list", async () => {
      mock.onGet("/admin/rounds").reply(200, ROUNDS);
      mock.onDelete("/rounds/round-1").reply(200, { round: null, recalculation: null });

      const { queryClient } = renderAsRole("admin");
      // Simulates the admin having viewed this round's own detail
      // screen at some earlier point -- populates exactly the cache
      // entry deleteMutation must clear.
      queryClient.setQueryData(["rounds", "round-1"], { id: "round-1", status: "approved" });
      expect(queryClient.getQueryData(["rounds", "round-1"])).toBeDefined();

      await screen.findByText("Alice Whitfield");
      const [firstDeleteButton] = await screen.findAllByRole("button", { name: "Delete" });
      await userEvent.click(firstDeleteButton!);
      const dialog = await screen.findByRole("dialog", { name: "Delete round" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete round" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Round deleted."));
      expect(queryClient.getQueryData(["rounds", "round-1"])).toBeUndefined();
    });

    it("shows a plain 'Round deleted.' toast when the round never had a recorded score, no recalculation claimed", async () => {
      mock.onGet("/admin/rounds").reply(200, ROUNDS);
      mock.onDelete("/rounds/round-2").reply(200, { round: null, recalculation: null });

      renderAsRole("admin");
      await screen.findByText("Bob Carver");
      const deleteButtons = await screen.findAllByRole("button", { name: "Delete" });
      await userEvent.click(deleteButtons[1]!);

      const dialog = await screen.findByRole("dialog", { name: "Delete round" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete round" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Round deleted."));
      expect(screen.getByRole("status")).not.toHaveTextContent(/recalculated/);
    });

    it("shows the server's error message on a failed delete, keeping the confirmation open", async () => {
      mock.onGet("/admin/rounds").reply(200, ROUNDS);
      mock.onDelete("/rounds/round-1").reply(500, { error: "unexpected failure" });

      renderAsRole("admin");
      await screen.findByText("Alice Whitfield");
      const [firstDeleteButton] = await screen.findAllByRole("button", { name: "Delete" });
      await userEvent.click(firstDeleteButton!);

      const dialog = await screen.findByRole("dialog", { name: "Delete round" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete round" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unexpected failure"));
      expect(screen.getByRole("dialog", { name: "Delete round" })).toBeInTheDocument();
    });
  });
});
