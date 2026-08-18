import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RequireRole } from "./RequireRole";
import { setTokens } from "../../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

function tokensForRole(role: string) {
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

describe("RequireRole", () => {
  it("renders children when the user's role matches", () => {
    setTokens(tokensForRole("admin"));
    render(
      <RequireRole role="admin">
        <p>Admin content</p>
      </RequireRole>,
    );
    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });

  it("renders nothing by default when the role doesn't match", () => {
    setTokens(tokensForRole("player"));
    const { container } = render(
      <RequireRole role="admin">
        <p>Admin content</p>
      </RequireRole>,
    );
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the fallback when provided and the role doesn't match", () => {
    setTokens(tokensForRole("player"));
    render(
      <RequireRole role="admin" fallback={<p>Not allowed</p>}>
        <p>Admin content</p>
      </RequireRole>,
    );
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });

  it("accepts an array of allowed roles", () => {
    setTokens(tokensForRole("super_admin"));
    render(
      <RequireRole role={["admin", "super_admin"]}>
        <p>Admin content</p>
      </RequireRole>,
    );
    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });

  it("gates on no user (logged out) the same as a mismatched role", () => {
    setTokens(null);
    render(
      <RequireRole role="player">
        <p>Player content</p>
      </RequireRole>,
    );
    expect(screen.queryByText("Player content")).not.toBeInTheDocument();
  });
});
