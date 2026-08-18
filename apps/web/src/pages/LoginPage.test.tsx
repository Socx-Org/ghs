import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
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
// not just a mocked callback firing.
function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AppRoutes />
    </MemoryRouter>,
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

    await waitFor(() => expect(screen.getByText(/Signed in as/)).toBeInTheDocument());
    expect(screen.getByText("a@example.com", { exact: false })).toBeInTheDocument();
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
});
