import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { useHeartbeat } from "./useHeartbeat";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

const TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "player@example.com", ghs_role: "player" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

let mock: MockAdapter;

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onPost("/auth/heartbeat").reply(204);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  setHidden(false);
  vi.useRealTimers();
});

describe("useHeartbeat", () => {
  it("fires every 60 seconds while authenticated and visible, nothing before the first interval elapses", async () => {
    setTokens(TOKENS);
    renderHook(() => useHeartbeat());
    expect(mock.history.post).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(2);
  });

  it("stops sending while the tab is hidden and resumes the normal cadence (not a burst of missed beats) when it becomes visible again", async () => {
    setTokens(TOKENS);
    renderHook(() => useHeartbeat());

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(1);

    act(() => setHidden(true));
    await act(async () => {
      // Well over 60s -- if hidden time silently accumulated, this
      // would produce several missed beats' worth of catch-up calls.
      vi.advanceTimersByTime(5 * 60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(1);

    act(() => setHidden(false));
    await act(async () => {
      // Becoming visible resumes the cadence -- it does not itself
      // fire a beat, and the very next one is still a full interval
      // away, not an immediate catch-up call.
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(2);
  });

  it("sends no heartbeat before authentication resolves, and stops immediately on logout", async () => {
    renderHook(() => useHeartbeat());
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(0);

    act(() => setTokens(TOKENS));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(1);

    act(() => setTokens(null));
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
      await Promise.resolve();
    });
    expect(mock.history.post).toHaveLength(1);
  });
});
