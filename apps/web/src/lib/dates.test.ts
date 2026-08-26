import { describe, expect, it } from "vitest";
import { isoStringToDateInputValue, playedAtToIsoString } from "./dates";

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
