import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/login-attempts"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const ATTEMPTS = {
  items: [
    {
      id: "attempt-1",
      email: "success@example.com",
      userId: "user-1",
      outcome: "success",
      ipAddress: "203.0.113.5",
      country: null,
      region: null,
      city: null,
      sessionId: "session-1",
      createdAt: "2026-05-01T10:00:00.000Z",
      sessionStatus: "active",
      sessionEndedAt: null,
    },
    {
      id: "attempt-2",
      email: "failed@example.com",
      userId: null,
      outcome: "invalid_credentials",
      ipAddress: "198.51.100.9",
      country: null,
      region: null,
      city: null,
      sessionId: null,
      createdAt: "2026-05-01T09:00:00.000Z",
      sessionStatus: null,
      sessionEndedAt: null,
    },
  ],
  total: 2,
};

describe("AdminLoginAttemptsPage", () => {
  it("redirects a non-admin away", () => {
    renderAsRole("player");
    expect(screen.queryByRole("heading", { name: "Login Audit" })).not.toBeInTheDocument();
  });

  it("shows every login attempt with its real outcome, for an admin", async () => {
    mock.onGet("/admin/login-attempts").reply(200, ATTEMPTS);
    renderAsRole("admin");

    expect(await screen.findByText("success@example.com")).toBeInTheDocument();
    expect(screen.getByText("failed@example.com")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Success")).toBeInTheDocument();
    expect(within(table).getByText("Invalid credentials")).toBeInTheDocument();
  });

  it("renders the live session status only for the successful attempt -- '--' (the Status column, last cell) for the failed one", async () => {
    mock.onGet("/admin/login-attempts").reply(200, ATTEMPTS);
    renderAsRole("admin");
    await screen.findByText("success@example.com");

    const table = screen.getByRole("table");
    const successRow = within(table).getByText("success@example.com").closest("tr")!;
    expect(within(successRow).getByText("Active")).toBeInTheDocument();

    const failedRow = within(table).getByText("failed@example.com").closest("tr")!;
    const failedStatusCell = within(failedRow).getAllByRole("cell").at(-1)!;
    expect(failedStatusCell).toHaveTextContent("—");
  });

  it("renders '--' for geo-IP location columns -- not yet populated (ghs#234)", async () => {
    mock.onGet("/admin/login-attempts").reply(200, ATTEMPTS);
    renderAsRole("admin");
    await screen.findByText("success@example.com");

    const table = screen.getByRole("table");
    const successRow = within(table).getByText("success@example.com").closest("tr")!;
    const locationCell = within(successRow).getAllByRole("cell")[4]!;
    expect(locationCell).toHaveTextContent("—");
  });

  it("filters by outcome", async () => {
    mock.onGet("/admin/login-attempts").reply(200, ATTEMPTS);
    renderAsRole("admin");
    await screen.findByText("success@example.com");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Outcome" }), "invalid_credentials");
    expect(screen.queryByText("success@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("failed@example.com")).toBeInTheDocument();
  });

  it("shows an empty state when there are no login attempts at all", async () => {
    mock.onGet("/admin/login-attempts").reply(200, { items: [], total: 0 });
    renderAsRole("admin");

    expect(await screen.findByText("No login attempts yet")).toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    mock.onGet("/admin/login-attempts").reply(500, { error: "unexpected failure" });
    renderAsRole("admin");

    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected failure");
  });

  it("sorts by Email, using real column order rather than insertion order", async () => {
    mock.onGet("/admin/login-attempts").reply(200, ATTEMPTS);
    renderAsRole("admin");
    await screen.findByText("success@example.com");

    const table = screen.getByRole("table");
    function emailColumn(): string[] {
      return within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0]!.textContent!);
    }

    await userEvent.click(screen.getByRole("button", { name: /^Email/ }));
    expect(emailColumn()).toEqual(["failed@example.com", "success@example.com"]);
    await userEvent.click(screen.getByRole("button", { name: /^Email/ }));
    expect(emailColumn()).toEqual(["success@example.com", "failed@example.com"]);
  });
});
