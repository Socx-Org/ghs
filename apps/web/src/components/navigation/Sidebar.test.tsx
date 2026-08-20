import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { setTokens } from "../../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

function tokensFor(role: string) {
  return {
    accessToken: makeAccessToken({ sub: "user-1", email: "a@example.com", ghs_role: role }),
    refreshToken: "refresh-1",
    expiresIn: 900,
  };
}

afterEach(() => {
  cleanup();
  setTokens(null);
});

function renderSidebar(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("always shows Dashboard", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
  });

  it("shows New Round only for a player", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /New Round/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Create Account/ })).not.toBeInTheDocument();
  });

  it("shows Create Account only for admin/super_admin, not New Round", () => {
    setTokens(tokensFor("admin"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /Create Account/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /New Round/ })).not.toBeInTheDocument();
  });

  it("shows Accounts only for admin/super_admin (ghs#104)", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.queryByRole("link", { name: /^Accounts$/ })).not.toBeInTheDocument();

    cleanup();
    setTokens(tokensFor("admin"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /^Accounts$/ })).toBeInTheDocument();
  });

  it("marks the current route's link as active", () => {
    setTokens(tokensFor("player"));
    renderSidebar("/rounds/new");
    expect(screen.getByRole("link", { name: /New Round/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Dashboard/ })).not.toHaveAttribute("aria-current");
  });

  it("marks Dashboard active only for an exact match, not every route (end prop)", () => {
    setTokens(tokensFor("player"));
    renderSidebar("/rounds/new");
    expect(screen.getByRole("link", { name: /Dashboard/ })).not.toHaveAttribute("aria-current", "page");
  });

  it("real logo is present", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.getByRole("img", { name: "GHS" })).toBeInTheDocument();
  });
});
