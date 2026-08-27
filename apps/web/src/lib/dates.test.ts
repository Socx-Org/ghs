import { afterEach, describe, expect, it, vi } from "vitest";
import { isoStringToDateInputValue, playedAtToIsoString, today } from "./dates";

afterEach(() => {
  vi.useRealTimers();
});

// ghs#169's own acceptance criteria: prove the round-trip holds under a
// real negative-UTC-offset timezone, not just whichever one CI happens
// to run in. Restored unconditionally, even on failure, so one bad
// assertion can't leak a wrong TZ into every other test in the file.
function withTimeZone(timeZone: string, run: () => void): void {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    run();
  } finally {
    process.env.TZ = original;
  }
}

describe("playedAtToIsoString", () => {
  it("round-trips the picked calendar day without a timezone shift (review finding, PR #95)", () => {
    // A bare new Date("2026-05-01") is UTC midnight -- in a negative-
    // UTC-offset timezone, later re-reading it locally (exactly what
    // toLocaleDateString() elsewhere in this app does) shows April 30,
    // not May 1. Asserting local getFullYear/getMonth/getDate (not a
    // fixed ISO string, which would itself be timezone-dependent to
    // assert against) proves the fix round-trips correctly regardless
    // of which timezone the test happens to run in.
    const iso = playedAtToIsoString("2026-05-01");
    const roundTripped = new Date(iso);
    expect(roundTripped.getFullYear()).toBe(2026);
    expect(roundTripped.getMonth()).toBe(4);
    expect(roundTripped.getDate()).toBe(1);
  });

  it("handles the first and last day of a month correctly", () => {
    expect(new Date(playedAtToIsoString("2026-01-01")).getDate()).toBe(1);
    expect(new Date(playedAtToIsoString("2026-01-31")).getDate()).toBe(31);
  });
});

// ghs#169: the read-direction counterpart to playedAtToIsoString, needed
// to pre-fill an <input type="date"> from an existing round's playedAt.
// Reads LOCAL date components, not UTC ones, for the same reason the
// write direction does -- a UTC-based slice would reintroduce the exact
// class of off-by-one-day bug PR #95 fixed, just for this direction.
describe("isoStringToDateInputValue", () => {
  it("extracts the calendar day as a plain YYYY-MM-DD string", () => {
    expect(isoStringToDateInputValue(playedAtToIsoString("2026-05-01"))).toBe("2026-05-01");
  });

  it("pads single-digit months and days", () => {
    expect(isoStringToDateInputValue(playedAtToIsoString("2026-01-05"))).toBe("2026-01-05");
  });

  it("round-trips through both directions without drifting a day, regardless of timezone", () => {
    for (const day of ["2026-01-01", "2026-01-31", "2026-06-15", "2026-12-31"]) {
      expect(isoStringToDateInputValue(playedAtToIsoString(day))).toBe(day);
    }
  });

  it("round-trips correctly under a real negative-UTC-offset timezone (America/Los_Angeles) -- the exact case PR #95 originally broke", () => {
    withTimeZone("America/Los_Angeles", () => {
      for (const day of ["2026-01-01", "2026-05-01", "2026-06-15", "2026-12-31"]) {
        expect(isoStringToDateInputValue(playedAtToIsoString(day))).toBe(day);
      }
    });
  });

  it("round-trips correctly under a real positive-UTC-offset timezone (Pacific/Kiritimati, UTC+14) too", () => {
    withTimeZone("Pacific/Kiritimati", () => {
      for (const day of ["2026-01-01", "2026-05-01", "2026-06-15", "2026-12-31"]) {
        expect(isoStringToDateInputValue(playedAtToIsoString(day))).toBe(day);
      }
    });
  });
});

// ghs#168 review fix: the exact bug this replaced --
// `new Date().toISOString().slice(0, 10)` reads UTC date parts, so an
// <input type="date"> could silently default to the wrong calendar day
// depending on the caller's own timezone and the time of day. Pinned to
// a specific real instant via fake timers (unlike the round-trip tests
// above, "now" isn't a caller-supplied value, so there's nothing else to
// pin against) so the assertion is a real, fixed expectation rather than
// "whatever today happens to be when this test runs."
describe("today", () => {
  it("returns the caller's LOCAL calendar day, not UTC's, once UTC has already rolled over (negative-UTC-offset timezone)", () => {
    // 2026-05-02T02:00:00.000Z is already May 2 in UTC, but only
    // 2026-05-01T19:00 PDT (UTC-7) -- still May 1 locally. The pre-fix
    // implementation would have returned "2026-05-02" here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T02:00:00.000Z"));
    withTimeZone("America/Los_Angeles", () => {
      expect(today()).toBe("2026-05-01");
    });
  });

  it("returns the caller's LOCAL calendar day once it has already rolled over ahead of UTC (positive-UTC-offset timezone)", () => {
    // 2026-05-01T20:00:00.000Z is still May 1 in UTC, but already
    // 2026-05-02T10:00 on Kiritimati (UTC+14) -- May 2 locally.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T20:00:00.000Z"));
    withTimeZone("Pacific/Kiritimati", () => {
      expect(today()).toBe("2026-05-02");
    });
  });
});
