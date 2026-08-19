import { describe, expect, it } from "vitest";
import { playedAtToIsoString } from "./dates";

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
