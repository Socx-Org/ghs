import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
import LoginPage from "./LoginPage";
import { RequireAuth } from "../routes/RequireAuth";
import { bootstrapClient } from "../lib/api";
import { setTokens } from "../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(bootstrapClient);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

// Rendered through the real AppRoutes (not LoginPage in isolation) so
// "logs in successfully" means what the acceptance criteria actually
// ask for: real end-to-end navigation to the authenticated destination,
// not just a mocked callback firing. QueryClientProvider is required
// once login lands on PlayerDashboardPage (ghs#65, TanStack Query) --
// retry: false so its unmocked `api` calls (this file only cares about
// the login flow, not dashboard data) settle to an error state quickly
// instead of retrying with backoff.
function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("shows client-side validation errors without calling the API", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("logs in directly (no MFA) and navigates to the authenticated destination", async () => {
    const tokens = {
      accessToken: makeAccessToken({ sub: "u1", email: "a@example.com", ghs_role: "player" }),
      refreshToken: "r1",
      expiresIn: 900,
    };
    mock.onPost("/auth/login").reply(200, tokens);

    renderLogin();
    await userEvent.type(screen.getByLabelText("Email address"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // Sign out is present on every authenticated-area screen regardless
    // of which one a given role lands on (ghs#65: this is now
    // PlayerDashboardPage for a player) -- proves real navigation past
    // login without coupling this login-flow test to a specific
    // dashboard's content.
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument());
  });

  it("shows the MFA step when the backend requires it, then verifies and navigates (including an MFA-enrolled user, acceptance criterion)", async () => {
    mock.onPost("/auth/login").reply(200, { mfaRequired: true, mfaPendingToken: "pending-1" });
    const tokens = {
      accessToken: makeAccessToken({ sub: "u2", email: "mfa@example.com", ghs_role: "admin" }),
      refreshToken: "r1",
      expiresIn: 900,
    };
    mock.onPost("/auth/mfa/verify").reply(200, tokens);

    renderLogin();
    await userEvent.type(screen.getByLabelText("Email address"), "mfa@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Two-factor verification" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Authentication code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(screen.getByText(/Signed in as/)).toBeInTheDocument());
    expect(screen.getByText("mfa@example.com", { exact: false })).toBeInTheDocument();
  });

  it("lets the user go back from the MFA step to re-enter credentials", async () => {
    mock.onPost("/auth/login").reply(200, { mfaRequired: true, mfaPendingToken: "pending-1" });
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email address"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Two-factor verification" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("shows a form-level error for invalid credentials, using the API's own message (acceptance criterion)", async () => {
    mock.onPost("/auth/login").reply(401, { error: "invalid credentials" });
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email address"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid credentials");
  });

  it("shows a distinct 'slow down' state for a 429, not the raw backend message (acceptance criterion)", async () => {
    mock.onPost("/auth/login").reply(429, { error: "too many authentication attempts" });
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email address"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/too many attempts/i);
    expect(alert).not.toHaveTextContent("too many authentication attempts");
  });

  it("rejects a malformed MFA code client-side before calling the API", async () => {
    mock.onPost("/auth/login").reply(200, { mfaRequired: true, mfaPendingToken: "pending-1" });
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email address"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Two-factor verification" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Authentication code"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Enter the 6-digit code from your authenticator app")).toBeInTheDocument();
    expect(mock.history.post?.filter((r) => r.url?.includes("mfa/verify"))).toHaveLength(0);
  });

  it("returns to the originally-requested protected page after login, not always / (review finding, PR #85)", async () => {
    // A custom route tree (not the app's real one, which only has "/" as
    // protected today) so this exercises the reusable from-state
    // mechanism itself, not just its current trivial case -- future
    // protected routes (#65 onward) get this for free.
    const tokens = {
      accessToken: makeAccessToken({ sub: "u1", email: "a@example.com", ghs_role: "player" }),
      refreshToken: "r1",
      expiresIn: 900,
    };
    mock.onPost("/auth/login").reply(200, tokens);

    render(
      <MemoryRouter initialEntries={["/some/protected/page"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/some/protected/page" element={<p>The protected page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // RequireAuth should have already redirected here with from state.
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Email address"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("The protected page")).toBeInTheDocument();
  });

  it("does not navigate after Back is clicked, even if the in-flight verify request later succeeds (review finding, PR #85)", async () => {
    mock.onPost("/auth/login").reply(200, { mfaRequired: true, mfaPendingToken: "pending-1" });

    let resolveVerify!: (value: [number, unknown]) => void;
    const verifyResponse = new Promise<[number, unknown]>((resolve) => {
      resolveVerify = resolve;
    });
    mock.onPost("/auth/mfa/verify").reply(() => verifyResponse);

    renderLogin();
    await userEvent.type(screen.getByLabelText("Email address"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Two-factor verification" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Authentication code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    // Back is disabled while the request is in flight -- this click must
    // have no effect, not queue up a step change for later.
    const backButton = screen.getByRole("button", { name: "Back" });
    expect(backButton).toBeDisabled();
    await userEvent.click(backButton);
    expect(screen.getByRole("heading", { name: "Two-factor verification" })).toBeInTheDocument();

    const tokens = {
      accessToken: makeAccessToken({ sub: "u2", email: "mfa@example.com", ghs_role: "admin" }),
      refreshToken: "r1",
      expiresIn: 900,
    };
    resolveVerify([200, tokens]);

    // Because Back was correctly blocked (disabled, not just visually
    // discouraged), the request that was already in flight completes
    // normally and navigates through -- the fix closes the race without
    // leaving the form stuck or the request orphaned.
    await waitFor(() => expect(screen.getByText(/Signed in as/)).toBeInTheDocument());
    expect(screen.getByText("mfa@example.com", { exact: false })).toBeInTheDocument();
  });
});
