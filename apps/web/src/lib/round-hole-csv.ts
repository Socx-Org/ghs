import Papa from "papaparse";
import { csvNumberOrUndefined } from "./csv-number";
import { csvHoleRowSchema } from "./hole-score-schema";
import type { AddHoleScoreInput } from "./api";

// ghs#160: RoundEntryPage's CSV-import alternative to filling in each
// HoleEntryCard by hand. Parsing/validation lives here, framework-free,
// directly unit-testable without any React rendering involved -- same
// shape as course-csv.ts's own separation (ghs#155).
//
// Deliberately hole-data only (confirmed scope decision, this issue's
// own text): course/tee configuration/player/date/tournament/9-hole are
// not part of this format at all -- they're already fixed by the time a
// round reaches RoundEntryPage. holeCount (the valid 1..holeCount range
// for hole_number) is a parameter, not a fixed 9-or-18 enum the way
// course-csv.ts's own hole_count column was -- here it comes from the
// round's own already-created real tee configuration, known at import
// time, not from the file itself.

export class RoundHoleCsvParseError extends Error {}

const REQUIRED_COLUMNS = ["hole_number", "strokes"] as const;

export interface ParsedHoleRowOutcome {
  holeNumber: number;
  valid: boolean;
  // Populated when valid -- the exact payload shape addHoleScore's
  // POST /rounds/:id/holes already accepts, already run through the
  // same csvHoleRowSchema strokes/putts validation HoleEntryCard's own
  // manual form uses.
  input?: AddHoleScoreInput;
  // Populated when !valid -- why this row is being skipped.
  reason?: string;
}

export interface ParsedRoundHoleCsv {
  outcomes: ParsedHoleRowOutcome[];
}

interface RawRow {
  [column: string]: string | undefined;
}

// TRUE | LEFT | RIGHT (case-insensitive), blank -> not recorded (undefined,
// left alone) -- a deliberate clarification from the platform owner, not
// what the reference round-export sample this issue was filed with
// literally contains (its own fairway_hit column is only ever blank or
// a plain true/false, with no miss-direction captured at all). null
// return -- distinct from `{ value: undefined }` -- signals a genuinely
// unparseable value, not "not recorded."
function parseFairwayHit(raw: string | undefined): { value: "hit" | "missed_left" | "missed_right" | undefined } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return { value: undefined };
  const upper = trimmed.toUpperCase();
  if (upper === "TRUE") return { value: "hit" };
  if (upper === "LEFT") return { value: "missed_left" };
  if (upper === "RIGHT") return { value: "missed_right" };
  return null;
}

// true/false (case-insensitive), blank -> not recorded (undefined, left
// alone). null return signals a genuinely unparseable value.
function parseOptionalBoolean(raw: string | undefined): { value: boolean | undefined } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return { value: undefined };
  const lower = trimmed.toLowerCase();
  if (lower === "true") return { value: true };
  if (lower === "false") return { value: false };
  return null;
}

function parseHoleRow(row: RawRow, holeCount: number): ParsedHoleRowOutcome {
  const holeNumberRaw = (row.hole_number ?? "").trim();
  const holeNumber = Number(holeNumberRaw);
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > holeCount) {
    return {
      holeNumber: Number.isFinite(holeNumber) ? holeNumber : -1,
      valid: false,
      reason: `invalid hole number '${holeNumberRaw}' (must be an integer from 1 to ${holeCount})`,
    };
  }

  const fairway = parseFairwayHit(row.fairway_hit);
  if (fairway === null) {
    return { holeNumber, valid: false, reason: `fairway_hit must be TRUE, LEFT, or RIGHT (got '${row.fairway_hit}')` };
  }
  const gir = parseOptionalBoolean(row.gir);
  if (gir === null) {
    return { holeNumber, valid: false, reason: `gir must be true or false (got '${row.gir}')` };
  }
  const inSand = parseOptionalBoolean(row.in_sand);
  if (inSand === null) {
    return { holeNumber, valid: false, reason: `in_sand must be true or false (got '${row.in_sand}')` };
  }

  const candidate = {
    strokes: csvNumberOrUndefined(row.strokes),
    putts: csvNumberOrUndefined(row.putts),
    gir: gir.value,
    fairwayResult: fairway.value,
    inSand: inSand.value,
    penalties: csvNumberOrUndefined(row.penalties),
  };

  const result = csvHoleRowSchema.safeParse(candidate);
  if (!result.success) {
    return { holeNumber, valid: false, reason: result.error.issues[0]?.message ?? "Invalid value" };
  }
  return { holeNumber, valid: true, input: { holeNumber, ...result.data } };
}

export function parseRoundHoleCsv(csvText: string, holeCount: number): ParsedRoundHoleCsv {
  const result = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    throw new RoundHoleCsvParseError(`Couldn't parse this file: ${result.errors[0]!.message}.`);
  }

  const columns = result.meta.fields ?? [];
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missingColumns.length > 0) {
    throw new RoundHoleCsvParseError(`Missing required column(s): ${missingColumns.join(", ")}.`);
  }

  const rows = result.data;
  if (rows.length === 0) {
    throw new RoundHoleCsvParseError("This file has no data rows.");
  }

  const outcomes = rows.map((row) => parseHoleRow(row, holeCount));

  // Duplicate hole numbers across the file -- every row sharing a hole
  // number is flagged invalid, not just the second occurrence, since
  // there's no principled way to prefer one over another.
  const validCounts = new Map<number, number>();
  for (const outcome of outcomes) {
    if (outcome.valid) {
      validCounts.set(outcome.holeNumber, (validCounts.get(outcome.holeNumber) ?? 0) + 1);
    }
  }

  return {
    outcomes: outcomes.map((outcome) => {
      if (outcome.valid && (validCounts.get(outcome.holeNumber) ?? 0) > 1) {
        return { holeNumber: outcome.holeNumber, valid: false, reason: `duplicate hole number ${outcome.holeNumber} in the file` };
      }
      return outcome;
    }),
  };
}
