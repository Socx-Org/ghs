import { describe, expect, it } from "vitest";
import { TeeConfigurationHolesCsvParseError, parseTeeConfigurationHolesCsv } from "./tee-configuration-holes-csv";

const NINE_HOLE_CSV = `hole_number,distance_yards,par,stroke_index
1,300,5,1
2,310,4,2
3,320,4,3
4,330,5,4
5,340,4,5
6,350,4,6
7,360,5,7
8,370,4,8
9,380,4,9`;

describe("parseTeeConfigurationHolesCsv", () => {
  it("parses a real 9-hole file into an ordered holes array, matching distanceYards/par/strokeIndex", () => {
    const holes = parseTeeConfigurationHolesCsv(NINE_HOLE_CSV, 9);
    expect(holes).toHaveLength(9);
    expect(holes[0]).toEqual({ distanceYards: 300, par: 5, strokeIndex: 1 });
    expect(holes[8]).toEqual({ distanceYards: 380, par: 4, strokeIndex: 9 });
  });

  it("sorts rows by hole_number regardless of the file's own row order", () => {
    const shuffled = `hole_number,distance_yards,par,stroke_index
9,380,4,9
2,310,4,2
1,300,5,1
3,320,4,3
5,340,4,5
4,330,5,4
7,360,5,7
6,350,4,6
8,370,4,8`;
    const holes = parseTeeConfigurationHolesCsv(shuffled, 9);
    expect(holes.map((h) => h.distanceYards)).toEqual([300, 310, 320, 330, 340, 350, 360, 370, 380]);
  });

  it("throws when a required column is missing", () => {
    const csv = `hole_number,distance_yards,par
1,300,5`;
    expect(() => parseTeeConfigurationHolesCsv(csv, 9)).toThrow(TeeConfigurationHolesCsvParseError);
  });

  it("throws when the file has no data rows", () => {
    const csv = `hole_number,distance_yards,par,stroke_index`;
    expect(() => parseTeeConfigurationHolesCsv(csv, 9)).toThrow(TeeConfigurationHolesCsvParseError);
  });

  it("throws on a hole number out of range for the expected count -- review fix, PR #158's original bug class, now via the shared checkHoleNumberCompleteness", () => {
    // 8 rows covering 1-8 (no internal duplicate, no gap in that range),
    // but hole 11 is out of range for a 9-hole configuration -- exactly
    // the combination PR #158 fixed for course-csv.ts; this proves the
    // shared helper still catches it here too.
    const rows = [1, 2, 3, 4, 5, 6, 7, 11].map((n) => `${n},300,4,${n}`).join("\n");
    const csv = `hole_number,distance_yards,par,stroke_index\n${rows}`;
    expect(() => parseTeeConfigurationHolesCsv(csv, 9)).toThrow(/invalid hole number '11'/);
  });

  it("throws on a duplicate hole number", () => {
    const csv = `hole_number,distance_yards,par,stroke_index
1,300,5,1
1,310,4,2`;
    expect(() => parseTeeConfigurationHolesCsv(csv, 9)).toThrow(/duplicate hole number 1/);
  });

  it("throws on missing hole(s)", () => {
    const holes = Array.from({ length: 8 }, (_, i) => `${i + 1},300,4,${i + 1}`).join("\n");
    const csv = `hole_number,distance_yards,par,stroke_index\n${holes}`;
    expect(() => parseTeeConfigurationHolesCsv(csv, 9)).toThrow(/missing hole\(s\): 9/);
  });

  it("leaves an individual bad value as NaN rather than blocking the whole import -- same as every other CSV parser's own csvNumberOrUndefined convention, the shared teeConfigurationSchema's numberOrUndefined preprocessing turns NaN into undefined and surfaces a real 'Enter a distance' message once populated into the form, same as a manual entry's own blank field", () => {
    const csv = `hole_number,distance_yards,par,stroke_index
1,not-a-number,5,1
2,310,4,2
3,320,4,3
4,330,5,4
5,340,4,5
6,350,4,6
7,360,5,7
8,370,4,8
9,380,4,9`;
    const holes = parseTeeConfigurationHolesCsv(csv, 9);
    expect(holes[0]!.distanceYards).toBeNaN();
    expect(holes[0]!.par).toBe(5);
  });
});
