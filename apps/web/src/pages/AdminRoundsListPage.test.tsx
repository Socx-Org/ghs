import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/rounds"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
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
});
