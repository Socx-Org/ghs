import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppRoutes from "./AppRoutes";
import { setTokens } from "./lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

const AUTHENTICATED_TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "alice@example.com", ghs_role: "player" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

const ADMIN_TOKENS = {
  accessToken: makeAccessToken({ sub: "admin-1", email: "admin@example.com", ghs_role: "admin" }),
  refreshToken: "refresh-2",
  expiresIn: 900,
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  setTokens(null);
  localStorage.clear();
});

describe("AppRoutes", () => {
  it("renders the login form at /login when unauthenticated", () => {
    renderAt("/login");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects / to /login when unauthenticated", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("renders the dashboard placeholder at / when authenticated", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/");
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    expect(screen.getByText("alice@example.com", { exact: false })).toBeInTheDocument();
  });

  it("redirects /login to / when already authenticated", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/login");
    expect(screen.queryByRole("heading", { name: "Sign in to your account" })).not.toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
  });

  it("redirects an unknown route to / (which itself redirects to /login when unauthenticated)", () => {
    renderAt("/some/unknown/path");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects /admin/users/new to /login when unauthenticated (ghs#86)", () => {
    renderAt("/admin/users/new");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects /admin/users/new to / for an authenticated non-admin (ghs#86)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/admin/users/new");
    expect(screen.queryByRole("heading", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
  });

  it("renders the admin create-user form at /admin/users/new for an admin (ghs#86)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/admin/users/new");
    expect(screen.getByRole("heading", { name: "Create account" })).toBeInTheDocument();
  });
});
