import { describe, expect, it } from "vitest";
import { RoundHoleCsvParseError, parseRoundHoleCsv } from "./round-hole-csv";

// ghs#160: the corrected-format sample from the issue itself (fairway_hit
// as TRUE/LEFT/RIGHT, not the reference round-export's own plain
// true/false with no miss-direction) -- an 18-hole round.
const VALID_CSV = `hole_number,strokes,putts,gir,fairway_hit,in_sand,penalties
1,6,2,false,,false,0
2,4,2,false,,true,0
3,6,2,false,,false,1
4,5,3,true,TRUE,false,0
5,4,2,true,TRUE,false,0
6,5,3,true,TRUE,false,0
7,4,1,false,TRUE,false,0
8,5,2,false,TRUE,false,0
9,4,1,false,,true,0
10,3,2,true,,false,0
11,5,1,false,TRUE,true,0
12,4,2,false,,false,0
13,4,2,true,TRUE,false,0
14,4,2,true,TRUE,false,0
15,5,2,true,TRUE,true,0
16,4,2,true,TRUE,false,0
17,3,2,true,,false,0
18,4,2,true,,false,0`;

describe("parseRoundHoleCsv", () => {
  it("parses all 18 holes as valid, with the exact addHoleScore payload shape", () => {
    const result = parseRoundHoleCsv(VALID_CSV, 18);
    expect(result.outcomes).toHaveLength(18);
    expect(result.outcomes.every((outcome) => outcome.valid)).toBe(true);

    const hole4 = result.outcomes.find((outcome) => outcome.holeNumber === 4);
    expect(hole4?.input).toEqual({
      holeNumber: 4,
      strokes: 5,
      putts: 3,
      gir: true,
      fairwayResult: "hit",
      inSand: false,
      penalties: 0,
    });

    // Hole 1: fairway_hit blank -> omitted (undefined), not "hit"/false --
    // "leave alone," matching addHoleScore's own upsert semantics.
    const hole1 = result.outcomes.find((outcome) => outcome.holeNumber === 1);
    expect(hole1?.input).toEqual({ holeNumber: 1, strokes: 6, putts: 2, gir: false, fairwayResult: undefined, inSand: false, penalties: 0 });
  });

  it("maps fairway_hit's TRUE/LEFT/RIGHT to hit/missed_left/missed_right (case-insensitive)", () => {
    const csv = `hole_number,strokes,fairway_hit
1,4,true
2,4,LEFT
3,4,right`;
    const result = parseRoundHoleCsv(csv, 3);
    expect(result.outcomes[0]!.input?.fairwayResult).toBe("hit");
    expect(result.outcomes[1]!.input?.fairwayResult).toBe("missed_left");
    expect(result.outcomes[2]!.input?.fairwayResult).toBe("missed_right");
  });

  it("rejects an unrecognised fairway_hit value, distinct from blank (not recorded)", () => {
    const csv = `hole_number,strokes,fairway_hit
1,4,sideways`;
    const result = parseRoundHoleCsv(csv, 1);
    expect(result.outcomes[0]!.valid).toBe(false);
    expect(result.outcomes[0]!.reason).toMatch(/fairway_hit must be TRUE, LEFT, or RIGHT/);
  });

  it("skips a row missing the required strokes value", () => {
    const csv = `hole_number,strokes
1,`;
    const result = parseRoundHoleCsv(csv, 1);
    expect(result.outcomes[0]!.valid).toBe(false);
    expect(result.outcomes[0]!.reason).toMatch(/Enter a stroke count/);
  });

  it("skips a row whose hole_number is out of range for this round's real hole count", () => {
    const csv = `hole_number,strokes
10,4`;
    const result = parseRoundHoleCsv(csv, 9);
    expect(result.outcomes[0]!.valid).toBe(false);
    expect(result.outcomes[0]!.reason).toMatch(/invalid hole number '10' \(must be an integer from 1 to 9\)/);
  });

  it("flags every row sharing a duplicate hole number as invalid, not just the second one", () => {
    const csv = `hole_number,strokes
5,4
5,5`;
    const result = parseRoundHoleCsv(csv, 18);
    expect(result.outcomes.every((outcome) => !outcome.valid)).toBe(true);
    expect(result.outcomes[0]!.reason).toMatch(/duplicate hole number 5/);
    expect(result.outcomes[1]!.reason).toMatch(/duplicate hole number 5/);
  });

  it("leaves optional fields blank (undefined) rather than defaulting them, matching addHoleScore's upsert semantics", () => {
    const csv = `hole_number,strokes,putts,gir,fairway_hit,in_sand,penalties
1,4,,,,,`;
    const result = parseRoundHoleCsv(csv, 1);
    expect(result.outcomes[0]!.valid).toBe(true);
    expect(result.outcomes[0]!.input).toEqual({
      holeNumber: 1,
      strokes: 4,
      putts: undefined,
      gir: undefined,
      fairwayResult: undefined,
      inSand: undefined,
      penalties: undefined,
    });
  });

  it("throws RoundHoleCsvParseError for an empty file", () => {
    expect(() => parseRoundHoleCsv("", 18)).toThrow(RoundHoleCsvParseError);
  });

  it("throws RoundHoleCsvParseError when a required column is missing", () => {
    // strokes itself is the missing required column -- gir alone isn't
    // enough for Papa to need delimiter auto-detection against a
    // single-column file, an unrelated edge case this test isn't about.
    const csv = `hole_number,gir\n1,true`;
    expect(() => parseRoundHoleCsv(csv, 18)).toThrow(/Missing required column/);
  });

  it("throws RoundHoleCsvParseError when the header is present but there are no data rows", () => {
    const headerOnly = "hole_number,strokes";
    expect(() => parseRoundHoleCsv(headerOnly, 18)).toThrow(/no data rows/);
  });

  it("supports a 9-hole round's own smaller valid range", () => {
    const csv = `hole_number,strokes
9,4`;
    const result = parseRoundHoleCsv(csv, 9);
    expect(result.outcomes[0]!.valid).toBe(true);

    const outOfRange = parseRoundHoleCsv(`hole_number,strokes\n10,4`, 9);
    expect(outOfRange.outcomes[0]!.valid).toBe(false);
  });
});
