import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAuth } from "./useAuth";
import { setTokens } from "../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

const TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "alice@example.com", ghs_role: "player" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

afterEach(() => {
  cleanup();
  setTokens(null);
  localStorage.clear();
});

describe("useAuth", () => {
  it("reflects no session as unauthenticated", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("re-renders with the decoded user once tokens are set (external store subscription)", () => {
    const { result } = renderHook(() => useAuth());
    act(() => setTokens(TOKENS));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ sub: "user-1", email: "alice@example.com", role: "player" });
  });

  it("re-renders back to unauthenticated after logout clears tokens", () => {
    setTokens(TOKENS);
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
    act(() => setTokens(null));
    expect(result.current.isAuthenticated).toBe(false);
  });
});
