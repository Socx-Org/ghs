import { describe, expect, it } from "vitest";
import { checkHoleNumberCompleteness } from "./csv-hole-completeness";

function holes(numbers: number[]): { raw: string; value: number }[] {
  return numbers.map((n) => ({ raw: String(n), value: n }));
}

describe("checkHoleNumberCompleteness", () => {
  it("returns null for a genuinely complete, in-range, non-duplicated set", () => {
    expect(checkHoleNumberCompleteness(holes([1, 2, 3, 4, 5, 6, 7, 8, 9]), 9)).toBeNull();
  });

  it("order of rows doesn't matter -- only the resulting set", () => {
    expect(checkHoleNumberCompleteness(holes([9, 3, 1, 7, 2, 5, 4, 8, 6]), 9)).toBeNull();
  });

  it("ghs#229/PR #158's own bug class: an out-of-range hole number with no internal duplicate/gap in the valid range is still caught, not silently accepted", () => {
    // 1-7 present (no duplicate, no gap in 1-7), but 11 is out of range
    // for a 9-hole configuration -- a naive "duplicates/gaps only" check
    // would miss this entirely.
    const reason = checkHoleNumberCompleteness(holes([1, 2, 3, 4, 5, 6, 7, 11]), 9);
    expect(reason).toMatch(/invalid hole number '11'/);
  });

  it("reports a duplicate hole number", () => {
    const reason = checkHoleNumberCompleteness(holes([1, 2, 2, 3, 4, 5, 6, 7, 8]), 9);
    expect(reason).toMatch(/duplicate hole number 2/);
  });

  it("reports missing hole(s)", () => {
    const reason = checkHoleNumberCompleteness(holes([1, 2, 3, 4, 5, 6, 7, 8]), 9);
    expect(reason).toMatch(/missing hole\(s\): 9/);
  });

  it("reports every missing hole, not just the first", () => {
    const reason = checkHoleNumberCompleteness(holes([1, 2, 3]), 9);
    expect(reason).toMatch(/missing hole\(s\): 4, 5, 6, 7, 8, 9/);
  });

  it("a non-numeric raw value (NaN after Number()) is reported using its original raw string, not 'NaN'", () => {
    const reason = checkHoleNumberCompleteness([{ raw: "abc", value: NaN }, ...holes([1, 2, 3, 4, 5, 6, 7, 8])], 9);
    expect(reason).toMatch(/invalid hole number 'abc'/);
  });
});
