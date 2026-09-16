import { describe, expect, it } from "vitest";
import { displayGrossScore } from "./rounds";
import type { PlayerRoundListItem } from "../types/domain";

function round(status: PlayerRoundListItem["status"], grossScore: number | null): PlayerRoundListItem {
  return {
    id: "r1", playerId: "p1", courseId: "c1", courseName: "Pebble Beach", teeConfigurationId: "t1",
    teeConfigurationName: "Blue", playedAt: "2026-05-01T09:00:00.000Z", status, grossScore,
  };
}

describe("displayGrossScore", () => {
  it("shows the real score once approved", () => {
    expect(displayGrossScore(round("approved", 88))).toBe("88");
  });

  it("withholds a non-approved round's score, even though it's already real and non-null (ghs#168/#205)", () => {
    expect(displayGrossScore(round("pending", 90))).toBe("—");
    expect(displayGrossScore(round("draft", 90))).toBe("—");
    expect(displayGrossScore(round("rejected", 90))).toBe("—");
    expect(displayGrossScore(round("amending", 90))).toBe("—");
  });

  it("shows '—' for an approved round with no recorded score (a real null, not withheld data)", () => {
    expect(displayGrossScore(round("approved", null))).toBe("—");
  });
});
