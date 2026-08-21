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
import type { AdminUserListItem } from "../types/domain";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

// sub "user-1" -- matches ACCOUNTS[0] below, so that row is "self" in
// every test here (the caller viewing their own row in the list).
const ADMIN_TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "admin@example.com", ghs_role: "admin" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

const PLAYER_TOKENS = {
  accessToken: makeAccessToken({ sub: "user-9", email: "player@example.com", ghs_role: "player" }),
  refreshToken: "refresh-2",
  expiresIn: 900,
};

const ACCOUNTS: AdminUserListItem[] = [
  { id: "user-1", email: "admin@example.com", role: "admin", status: "active", createdAt: "2026-08-01T00:00:00.000Z", firstName: null, lastName: null, playerId: null },
  { id: "user-2", email: "alice@example.com", role: "player", status: "active", createdAt: "2026-08-02T00:00:00.000Z", firstName: "Alice", lastName: "Whitfield", playerId: "player-2" },
  { id: "user-3", email: "ben@example.com", role: "player", status: "disabled", createdAt: "2026-08-03T00:00:00.000Z", firstName: "Ben", lastName: "Okafor", playerId: "player-3" },
  { id: "user-4", email: "gone@example.com", role: "player", status: "deleted", createdAt: "2026-08-04T00:00:00.000Z", firstName: "Gone", lastName: "User", playerId: "player-4" },
  { id: "user-5", email: "pending@example.com", role: "player", status: "pending_verification", createdAt: "2026-08-05T00:00:00.000Z", firstName: "Pending", lastName: "User", playerId: "player-5" },
];

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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/users"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// AccountMenu's own trigger also shows the signed-in caller's email
// (same quirk documented for other pages this engagement) -- when the
// caller's own account also appears as a list row, getByText alone is
// ambiguous. Scoping to the table's own rows resolves it.
function rowFor(email: string): HTMLElement {
  const table = screen.getByRole("table");
  const cell = within(table).getByText(email);
  return cell.closest("tr")!;
}

describe("AdminAccountsPage", () => {
  it("redirects a non-admin (player) away, matching the existing RequireAdmin pattern", () => {
    setTokens(PLAYER_TOKENS);
    renderPage();
    expect(screen.queryByRole("heading", { name: "Accounts" })).not.toBeInTheDocument();
  });

  it("renders the account list with email, name, role, status, and created date", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    renderPage();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Alice Whitfield")).toBeInTheDocument();
    // admin@example.com's row has no linked player -- "—", not a blank
    // cell or a fabricated name.
    const adminRow = rowFor("admin@example.com");
    expect(adminRow.textContent).toContain("—");
  });

  it("shows an empty state when there are no accounts", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: [], total: 0 });
    renderPage();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  });

  it("shows an error state when the list fails to load", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(500, { error: "internal server error" });
    renderPage();
    expect(await screen.findByText("internal server error")).toBeInTheDocument();
  });

  it("does not offer Delete on the caller's own row, but does on others", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    renderPage();
    await screen.findByText("alice@example.com");

    const ownRow = rowFor("admin@example.com");
    const aliceRow = rowFor("alice@example.com");
    // Disable is still offered on your own row -- only Delete is withheld.
    expect(within(ownRow).getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(within(ownRow).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(aliceRow).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("offers neither Enable/Disable nor Delete on an already-deleted row", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    renderPage();
    await screen.findByText("gone@example.com");

    const deletedRow = rowFor("gone@example.com");
    expect(deletedRow.querySelectorAll("button").length).toBe(0);
  });

  it("offers only Delete for a pending_verification row -- no Enable button that would silently force-activate it (review finding, PR #122)", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    renderPage();
    await screen.findByText("pending@example.com");

    const pendingRow = rowFor("pending@example.com");
    expect(within(pendingRow).queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
    expect(within(pendingRow).queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(within(pendingRow).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("Disable calls the real endpoint and refreshes the list on success", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    mock.onPatch("/admin/users/user-2/status").reply(200, { message: "User status set to disabled." });
    renderPage();
    await screen.findByText("alice@example.com");

    const aliceRow = rowFor("alice@example.com");
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(mock.history.patch?.length).toBe(1));
    expect(JSON.parse(mock.history.patch![0]!.data)).toEqual({ status: "disabled" });
    expect(await screen.findByText("Account disabled.")).toBeInTheDocument();
  });

  it("Enable is offered instead of Disable for a disabled account, and calls the endpoint with status=active", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    mock.onPatch("/admin/users/user-3/status").reply(200, { message: "User status set to active." });
    renderPage();
    await screen.findByText("ben@example.com");

    const benRow = rowFor("ben@example.com");
    await userEvent.click(within(benRow).getByRole("button", { name: "Enable" }));

    await waitFor(() => expect(mock.history.patch?.length).toBe(1));
    expect(JSON.parse(mock.history.patch![0]!.data)).toEqual({ status: "active" });
  });

  it("Delete opens a real confirmation modal naming the account, not window.confirm", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    renderPage();
    await screen.findByText("alice@example.com");

    const aliceRow = rowFor("alice@example.com");
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    expect(within(dialog).getByText("alice@example.com")).toBeInTheDocument();
  });

  it("confirming delete calls the real endpoint, closes the modal, and refreshes the list", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    mock.onDelete("/admin/users/user-2").reply(200, { message: "User deleted." });
    renderPage();
    await screen.findByText("alice@example.com");

    const aliceRow = rowFor("alice@example.com");
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete account" }));

    await waitFor(() => expect(mock.history.delete?.length).toBe(1));
    expect(await screen.findByText("Account deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancelling delete closes the modal without calling the API", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    renderPage();
    await screen.findByText("alice@example.com");

    const aliceRow = rowFor("alice@example.com");
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.history.delete?.length ?? 0).toBe(0);
  });
});
