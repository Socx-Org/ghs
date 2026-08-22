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
  });

  it("shows My Rounds only for a player (ghs#147)", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /My Rounds/ })).toBeInTheDocument();

    cleanup();
    setTokens(tokensFor("admin"));
    renderSidebar();
    expect(screen.queryByRole("link", { name: /My Rounds/ })).not.toBeInTheDocument();
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

  it("shows Pending Rounds only for admin/super_admin (ghs#67)", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.queryByRole("link", { name: /Pending Rounds/ })).not.toBeInTheDocument();

    cleanup();
    setTokens(tokensFor("admin"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /Pending Rounds/ })).toBeInTheDocument();
  });

  it("shows All Rounds only for admin/super_admin (ghs#113)", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.queryByRole("link", { name: /All Rounds/ })).not.toBeInTheDocument();

    cleanup();
    setTokens(tokensFor("admin"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /All Rounds/ })).toBeInTheDocument();
  });

  it("shows Courses for every role, ghs#109 -- no role restriction on viewing", () => {
    setTokens(tokensFor("player"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /^Courses$/ })).toBeInTheDocument();

    cleanup();
    setTokens(tokensFor("admin"));
    renderSidebar();
    expect(screen.getByRole("link", { name: /^Courses$/ })).toBeInTheDocument();
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
