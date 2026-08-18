import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MockAdapter from "axios-mock-adapter";
import { api, ApiError, bootstrapClient, login, logout, verifyMfa } from "./api";
import { getTokens, getUser, setTokens } from "./auth-store";

// api.ts deliberately uses two separate axios instances (see its own
// comments) -- `api` (interceptor-bearing, used for real feature
// requests) and `bootstrapClient` (login/mfa-verify/refresh/logout).
// axios-mock-adapter attaches per-instance, so both need their own
// mock; a mock on `api` alone would silently let every bootstrapClient
// request through to a real (nonexistent, in tests) network call.
let mock: MockAdapter;
let bootstrapMock: MockAdapter;

const REAL_TOKENS = { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 900 };
const REFRESHED_TOKENS = { accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 };

beforeEach(() => {
  mock = new MockAdapter(api);
  bootstrapMock = new MockAdapter(bootstrapClient);
  localStorage.clear();
  setTokens(null);
});

afterEach(() => {
  mock.restore();
  bootstrapMock.restore();
  localStorage.clear();
  setTokens(null);
  vi.restoreAllMocks();
});

describe("api -- transparent refresh (acceptance criterion)", () => {
  it("retries the original request transparently after a 401, invisible to the caller", async () => {
    setTokens(REAL_TOKENS);
    let attempt = 0;
    mock.onGet("/rounds").reply(() => {
      attempt += 1;
      if (attempt === 1) return [401, { error: "token expired" }];
      return [200, { ok: true }];
    });
    bootstrapMock.onPost("/auth/refresh").reply(200, REFRESHED_TOKENS);

    const response = await api.get("/rounds");

    expect(response.data).toEqual({ ok: true });
    expect(attempt).toBe(2);
    expect(getTokens()).toEqual(REFRESHED_TOKENS);
  });
});

describe("api -- single-flight refresh (acceptance criterion)", () => {
  it("de-duplicates concurrent 401s into exactly one /auth/refresh call", async () => {
    setTokens(REAL_TOKENS);
    let refreshCalls = 0;
    let getCallCount = 0;

    mock.onGet("/rounds").reply(() => {
      getCallCount += 1;
      // Every request 401s until the refresh has actually completed --
      // otherwise a naively-passing test could hide a real
      // de-duplication bug if requests happened to race the refresh
      // themselves rather than each other.
      const tokens = getTokens();
      if (tokens?.accessToken === REFRESHED_TOKENS.accessToken) return [200, { ok: true }];
      return [401, { error: "token expired" }];
    });
    bootstrapMock.onPost("/auth/refresh").reply(() => {
      refreshCalls += 1;
      return [200, REFRESHED_TOKENS];
    });

    const results = await Promise.all([api.get("/rounds"), api.get("/rounds"), api.get("/rounds")]);

    expect(refreshCalls).toBe(1);
    expect(results.every((r) => r.data.ok)).toBe(true);
    expect(getCallCount).toBe(6); // 3 initial 401s + 3 retries
  });
});

describe("api -- refresh failure (acceptance criterion)", () => {
  it("clears session state and rejects cleanly when the refresh token is revoked/reused/expired", async () => {
    setTokens(REAL_TOKENS);
    mock.onGet("/rounds").reply(401, { error: "token expired" });
    bootstrapMock.onPost("/auth/refresh").reply(401, { error: "invalid or expired refresh token" });

    await expect(api.get("/rounds")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/rounds")).rejects.toMatchObject({ status: 401 });
    expect(getTokens()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

describe("api -- stale refresh response cannot resurrect a cleared session (review finding, PR #84)", () => {
  it("does not apply a refresh response that arrives after the user logged out mid-flight", async () => {
    setTokens(REAL_TOKENS);
    mock.onGet("/rounds").reply(401, { error: "token expired" });

    let resolveRefresh!: (value: [number, unknown]) => void;
    const refreshResponse = new Promise<[number, unknown]>((resolve) => {
      resolveRefresh = resolve;
    });
    bootstrapMock.onPost("/auth/refresh").reply(() => refreshResponse);

    const requestPromise = api.get("/rounds").catch((e: unknown) => e);

    // Let the 401 -> refresh kick off before logging out mid-flight.
    await Promise.resolve();
    await Promise.resolve();
    setTokens(null);

    // The (now-stale) refresh response arrives after the logout.
    resolveRefresh([200, REFRESHED_TOKENS]);
    await requestPromise;

    // Must still reflect the logout -- not resurrected by the stale response.
    expect(getTokens()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

describe("login / verifyMfa", () => {
  it("stores tokens on a direct (non-MFA) login", async () => {
    bootstrapMock.onPost("/auth/login").reply(200, REAL_TOKENS);
    const result = await login({ email: "a@example.com", password: "pw" });
    expect(result).toEqual(REAL_TOKENS);
    expect(getTokens()).toEqual(REAL_TOKENS);
  });

  it("does not store tokens when MFA is required, and returns the pending token", async () => {
    bootstrapMock.onPost("/auth/login").reply(200, { mfaRequired: true, mfaPendingToken: "pending-1" });
    const result = await login({ email: "a@example.com", password: "pw" });
    expect(result).toEqual({ mfaRequired: true, mfaPendingToken: "pending-1" });
    expect(getTokens()).toBeNull();
  });

  it("surfaces invalid credentials as a clean ApiError, not a raw axios error", async () => {
    bootstrapMock.onPost("/auth/login").reply(401, { error: "invalid credentials" });
    await expect(login({ email: "a@example.com", password: "wrong" })).rejects.toMatchObject({
      message: "invalid credentials",
      status: 401,
    });
  });

  it("stores tokens on successful MFA verification", async () => {
    bootstrapMock.onPost("/auth/mfa/verify").reply(200, REAL_TOKENS);
    const result = await verifyMfa({ mfaPendingToken: "pending-1", code: "123456" });
    expect(result).toEqual(REAL_TOKENS);
    expect(getTokens()).toEqual(REAL_TOKENS);
  });

  it("does not persist a login response that arrives after session state changed mid-flight (review finding, PR #84)", async () => {
    let resolveLogin!: (value: [number, unknown]) => void;
    const loginResponse = new Promise<[number, unknown]>((resolve) => {
      resolveLogin = resolve;
    });
    bootstrapMock.onPost("/auth/login").reply(() => loginResponse);

    const loginPromise = login({ email: "a@example.com", password: "pw" }).catch((e: unknown) => e);
    await Promise.resolve();
    setTokens(null); // something else changes session state mid-request

    resolveLogin([200, REAL_TOKENS]);
    const result = await loginPromise;

    expect(result).toBeInstanceOf(ApiError);
    expect(getTokens()).toBeNull();
  });
});

describe("logout (acceptance criterion -- clears state regardless of network outcome)", () => {
  it("clears local state when the logout call succeeds", async () => {
    setTokens(REAL_TOKENS);
    bootstrapMock.onPost("/auth/logout").reply(200, { message: "Logged out." });
    await logout();
    expect(getTokens()).toBeNull();
  });

  it("clears local state even when the logout call fails on the network", async () => {
    setTokens(REAL_TOKENS);
    bootstrapMock.onPost("/auth/logout").networkError();
    await logout();
    expect(getTokens()).toBeNull();
  });

  it("clears local state even when there is no refresh token to send", async () => {
    setTokens(null);
    await logout();
    expect(getTokens()).toBeNull();
  });
});
