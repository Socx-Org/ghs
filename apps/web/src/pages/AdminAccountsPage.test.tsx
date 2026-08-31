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

// sub "user-1" -- same id as ADMIN_TOKENS above, so "self" is a
// super_admin here instead of a plain admin (ghs#191's own edit-modal
// tests need both: role editing is super_admin-only).
const SUPER_ADMIN_TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "admin@example.com", ghs_role: "super_admin" }),
  refreshToken: "refresh-3",
  expiresIn: 900,
};

const ACCOUNTS: AdminUserListItem[] = [
  { id: "user-1", email: "admin@example.com", role: "admin", status: "active", createdAt: "2026-08-01T00:00:00.000Z", firstName: null, lastName: null, playerId: null },
  { id: "user-2", email: "alice@example.com", role: "player", status: "active", createdAt: "2026-08-02T00:00:00.000Z", firstName: "Alice", lastName: "Whitfield", playerId: "player-2" },
  { id: "user-3", email: "ben@example.com", role: "player", status: "disabled", createdAt: "2026-08-03T00:00:00.000Z", firstName: "Ben", lastName: "Okafor", playerId: "player-3" },
  { id: "user-4", email: "gone@example.com", role: "player", status: "deleted", createdAt: "2026-08-04T00:00:00.000Z", firstName: "Gone", lastName: "User", playerId: "player-4" },
  { id: "user-5", email: "pending@example.com", role: "player", status: "pending_verification", createdAt: "2026-08-05T00:00:00.000Z", firstName: "Pending", lastName: "User", playerId: "player-5" },
  // ghs#191: a second, non-self admin/super_admin row -- the role
  // selector's own tests need a target that isn't "self" and has no
  // players row.
  { id: "user-6", email: "carol@example.com", role: "admin", status: "active", createdAt: "2026-08-06T00:00:00.000Z", firstName: null, lastName: null, playerId: null },
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
    // ghs#134: row actions are icon-only -- each one's accessible name
    // (aria-label) names the account explicitly instead of relying on
    // visible "Disable"/"Delete" text.
    expect(within(ownRow).getByRole("button", { name: "Disable admin@example.com" })).toBeInTheDocument();
    expect(within(ownRow).queryByRole("button", { name: "Delete admin@example.com" })).not.toBeInTheDocument();
    expect(within(aliceRow).getByRole("button", { name: "Delete alice@example.com" })).toBeInTheDocument();
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
    expect(within(pendingRow).queryByRole("button", { name: "Enable pending@example.com" })).not.toBeInTheDocument();
    expect(within(pendingRow).queryByRole("button", { name: "Disable pending@example.com" })).not.toBeInTheDocument();
    expect(within(pendingRow).getByRole("button", { name: "Delete pending@example.com" })).toBeInTheDocument();
  });

  it("Disable calls the real endpoint and refreshes the list on success", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    mock.onPatch("/admin/users/user-2/status").reply(200, { message: "User status set to disabled." });
    renderPage();
    await screen.findByText("alice@example.com");

    const aliceRow = rowFor("alice@example.com");
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Disable alice@example.com" }));

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
    await userEvent.click(within(benRow).getByRole("button", { name: "Enable ben@example.com" }));

    await waitFor(() => expect(mock.history.patch?.length).toBe(1));
    expect(JSON.parse(mock.history.patch![0]!.data)).toEqual({ status: "active" });
  });

  it("Delete opens a real confirmation modal naming the account, not window.confirm", async () => {
    setTokens(ADMIN_TOKENS);
    mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
    renderPage();
    await screen.findByText("alice@example.com");

    const aliceRow = rowFor("alice@example.com");
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Delete alice@example.com" }));

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
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Delete alice@example.com" }));
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
    await userEvent.click(within(aliceRow).getByRole("button", { name: "Delete alice@example.com" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.history.delete?.length ?? 0).toBe(0);
  });

  describe("Edit account (ghs#191)", () => {
    it("opens a modal pre-filled with the account's current email and name", async () => {
      setTokens(ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      renderPage();
      await screen.findByText("alice@example.com");

      const aliceRow = rowFor("alice@example.com");
      await userEvent.click(within(aliceRow).getByRole("button", { name: "Edit alice@example.com" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      expect(within(dialog).getByLabelText("Email address")).toHaveValue("alice@example.com");
      expect(within(dialog).getByLabelText("First name")).toHaveValue("Alice");
      expect(within(dialog).getByLabelText("Last name")).toHaveValue("Whitfield");
    });

    it("shows no name fields for an account with no linked player (admin/super_admin)", async () => {
      setTokens(SUPER_ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      renderPage();
      await screen.findByText("carol@example.com");

      const carolRow = rowFor("carol@example.com");
      await userEvent.click(within(carolRow).getByRole("button", { name: "Edit carol@example.com" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      expect(within(dialog).queryByLabelText("First name")).not.toBeInTheDocument();
    });

    it("shows no role selector for a plain admin caller, even on an admin/super_admin target", async () => {
      setTokens(ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      renderPage();
      await screen.findByText("carol@example.com");

      const carolRow = rowFor("carol@example.com");
      await userEvent.click(within(carolRow).getByRole("button", { name: "Edit carol@example.com" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      expect(within(dialog).queryByLabelText("Role")).not.toBeInTheDocument();
    });

    it("shows no role selector when a super_admin edits their own row", async () => {
      setTokens(SUPER_ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      renderPage();
      // Waits for a table-only marker, not "admin@example.com" itself --
      // AccountMenu's own trigger shows the same email immediately
      // (no query dependency), so findByText could otherwise resolve
      // against that before the table has actually loaded.
      await screen.findByText("alice@example.com");

      const ownRow = rowFor("admin@example.com");
      await userEvent.click(within(ownRow).getByRole("button", { name: "Edit admin@example.com" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      expect(within(dialog).queryByLabelText("Role")).not.toBeInTheDocument();
    });

    it("shows no role selector for a player-role target, even for a super_admin caller -- crossing the player boundary is unsupported", async () => {
      setTokens(SUPER_ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      renderPage();
      await screen.findByText("alice@example.com");

      const aliceRow = rowFor("alice@example.com");
      await userEvent.click(within(aliceRow).getByRole("button", { name: "Edit alice@example.com" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      expect(within(dialog).queryByLabelText("Role")).not.toBeInTheDocument();
    });

    it("a super_admin editing another admin/super_admin's row sees a role selector, and submitting sends the selected role", async () => {
      setTokens(SUPER_ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      mock.onPatch("/admin/users/user-6").reply(200, { ...ACCOUNTS[5]!, role: "super_admin" });
      renderPage();
      await screen.findByText("carol@example.com");

      const carolRow = rowFor("carol@example.com");
      await userEvent.click(within(carolRow).getByRole("button", { name: "Edit carol@example.com" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      expect(within(dialog).getByLabelText("Role")).toHaveValue("admin");
      await userEvent.selectOptions(within(dialog).getByLabelText("Role"), "super_admin");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(mock.history.patch?.length).toBe(1));
      expect(JSON.parse(mock.history.patch![0]!.data)).toEqual({ email: "carol@example.com", role: "super_admin" });
      expect(await screen.findByText("Account updated.")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("submitting an email/name edit on a player account sends both, with no role key at all", async () => {
      setTokens(ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      mock.onPatch("/admin/users/user-2").reply(200, { ...ACCOUNTS[1]!, email: "alice2@example.com" });
      renderPage();
      await screen.findByText("alice@example.com");

      const aliceRow = rowFor("alice@example.com");
      await userEvent.click(within(aliceRow).getByRole("button", { name: "Edit alice@example.com" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit account" });

      const emailInput = within(dialog).getByLabelText("Email address");
      await userEvent.clear(emailInput);
      await userEvent.type(emailInput, "alice2@example.com");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(mock.history.patch?.length).toBe(1));
      expect(JSON.parse(mock.history.patch![0]!.data)).toEqual({ email: "alice2@example.com", firstName: "Alice", lastName: "Whitfield" });
    });

    it("shows a client-side validation error for an invalid email, without calling the API", async () => {
      setTokens(ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      renderPage();
      await screen.findByText("alice@example.com");

      const aliceRow = rowFor("alice@example.com");
      await userEvent.click(within(aliceRow).getByRole("button", { name: "Edit alice@example.com" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit account" });

      const emailInput = within(dialog).getByLabelText("Email address");
      await userEvent.clear(emailInput);
      await userEvent.type(emailInput, "not-an-email");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      expect(await within(dialog).findByText("Enter a valid email address")).toBeInTheDocument();
      expect(mock.history.patch?.length ?? 0).toBe(0);
    });

    it("keeps the modal open and shows an error toast on failure (e.g. a duplicate email, 409) -- the admin can fix and resubmit", async () => {
      setTokens(ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      mock.onPatch("/admin/users/user-2").reply(409, { error: "email already in use" });
      renderPage();
      await screen.findByText("alice@example.com");

      const aliceRow = rowFor("alice@example.com");
      await userEvent.click(within(aliceRow).getByRole("button", { name: "Edit alice@example.com" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("email already in use")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Edit account" })).toBeInTheDocument();
    });

    it("cancelling closes the modal without calling the API", async () => {
      setTokens(ADMIN_TOKENS);
      mock.onGet("/admin/users").reply(200, { items: ACCOUNTS, total: ACCOUNTS.length });
      renderPage();
      await screen.findByText("alice@example.com");

      const aliceRow = rowFor("alice@example.com");
      await userEvent.click(within(aliceRow).getByRole("button", { name: "Edit alice@example.com" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit account" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mock.history.patch?.length ?? 0).toBe(0);
    });
  });
});
