import { afterEach, describe, expect, it, vi } from "vitest";
import { getTokens, getUser, setTokens, subscribe } from "./auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

const CLAIMS = { sub: "user-1", email: "alice@example.com", email_verified: true, amr: ["pwd"], ghs_role: "admin", tokenType: "access" };
const TOKENS = { accessToken: makeAccessToken(CLAIMS), refreshToken: "refresh-1", expiresIn: 900 };

afterEach(() => {
  setTokens(null);
  localStorage.clear();
});

describe("auth-store", () => {
  it("starts with no tokens/user when nothing is stored", () => {
    expect(getTokens()).toBeNull();
    expect(getUser()).toBeNull();
  });

  it("setTokens derives the user from the raw (snake_case) JWT claims, not the server's camelCase remap", () => {
    setTokens(TOKENS);
    expect(getUser()).toEqual({ sub: "user-1", email: "alice@example.com", role: "admin" });
  });

  it("persists tokens to localStorage and clears them on setTokens(null)", () => {
    setTokens(TOKENS);
    expect(localStorage.getItem("ghs-auth")).toContain("refresh-1");
    setTokens(null);
    expect(localStorage.getItem("ghs-auth")).toBeNull();
    expect(getUser()).toBeNull();
  });

  it("notifies subscribers on every setTokens call", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setTokens(TOKENS);
    setTokens(null);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setTokens(TOKENS);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("treats an undecodable access token as no user, without throwing", () => {
    setTokens({ accessToken: "not-a-jwt", refreshToken: "refresh-1", expiresIn: 900 });
    expect(getUser()).toBeNull();
    expect(getTokens()).not.toBeNull();
  });
});
