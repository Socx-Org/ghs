import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Rendered through the real AppRoutes -- exercises RequireAuth too, not
// just this page component in isolation, same rationale as
// AdminCreateUserPage.test.tsx. A real QueryClientProvider ancestor is
// required here (unlike AdminCreateUserPage, which has no useQuery)
// since ProfilePage's GET /auth/me goes through useQuery -- same
// rationale as AppRoutes.test.tsx's own renderAt helper.
function renderAsRole(role: "player" | "admin" = "player") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/profile"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PLAYER_PROFILE = {
  id: "caller-1",
  email: "caller@example.com",
  role: "player",
  status: "active",
  firstName: "Sola",
  lastName: "Oderinde",
};

const ADMIN_PROFILE = {
  id: "caller-1",
  email: "caller@example.com",
  role: "admin",
  status: "active",
  firstName: null,
  lastName: null,
};

describe("ProfilePage", () => {
  it("shows the account's email, name, and role once GET /auth/me resolves", async () => {
    mock.onGet("/auth/me").reply(200, PLAYER_PROFILE);
    renderAsRole("player");

    // "Player" (the RoleBadge) only renders once the query resolves --
    // AccountMenu's own trigger already shows the email synchronously
    // from auth-store, independent of this page's query, so waiting on
    // the email alone would prove nothing about the query having
    // settled (getAllByText below, not getByText, since the trigger and
    // this card both show it -- both real, expected occurrences).
    expect(await screen.findByText("Player")).toBeInTheDocument();
    expect(screen.getAllByText("caller@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Sola Oderinde")).toBeInTheDocument();
  });

  // ghs#98: firstName/lastName are null for admin/super_admin -- no
  // players row exists for them at all -- so the Name row must not
  // render at all rather than showing "null null" or a blank row.
  it("omits the Name row for an admin account with no linked player", async () => {
    mock.onGet("/auth/me").reply(200, ADMIN_PROFILE);
    renderAsRole("admin");

    expect(await screen.findByText("Admin")).toBeInTheDocument();
    expect(screen.getAllByText("caller@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
  });

  it("shows an error alert when GET /auth/me fails", async () => {
    mock.onGet("/auth/me").reply(500, { error: "unexpected failure" });
    renderAsRole("player");

    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected failure");
  });

  it("shows client-side validation errors without calling change-password", async () => {
    mock.onGet("/auth/me").reply(200, PLAYER_PROFILE);
    renderAsRole("player");
    await screen.findByText("caller@example.com");

    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Current password is required")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("flags a mismatched confirmation without calling change-password", async () => {
    mock.onGet("/auth/me").reply(200, PLAYER_PROFILE);
    renderAsRole("player");
    await screen.findByText("caller@example.com");

    await userEvent.type(screen.getByLabelText("Current password"), "current-pass-1");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "does-not-match");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("changes the password and clears the form on success", async () => {
    mock.onGet("/auth/me").reply(200, PLAYER_PROFILE);
    mock.onPost("/auth/change-password").reply(200, { message: "Password changed." });
    renderAsRole("player");
    await screen.findByText("caller@example.com");

    await userEvent.type(screen.getByLabelText("Current password"), "current-pass-1");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Password changed."));
    expect(JSON.parse(mock.history.post![0].data)).toEqual({
      currentPassword: "current-pass-1",
      newPassword: "new-password-1",
    });
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
  });

  it("shows the server's error message (e.g. incorrect current password) via a form-level alert", async () => {
    mock.onGet("/auth/me").reply(200, PLAYER_PROFILE);
    mock.onPost("/auth/change-password").reply(400, { error: "current password is incorrect" });
    renderAsRole("player");
    await screen.findByText("caller@example.com");

    await userEvent.type(screen.getByLabelText("Current password"), "wrong-pass-1");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("current password is incorrect");
  });
});
