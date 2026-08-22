import Papa from "papaparse";
import { teeConfigurationSchema, toTeeConfigurationInput } from "./tee-configuration-schema";
import type { TeeConfigurationFormInput } from "./tee-configuration-schema";
import type { TeeConfigurationInput } from "../types/domain";

// ghs#155: Create Course's CSV-import alternative to manual entry.
// Parsing/grouping/validation lives here, framework-free, so it's
// directly unit-testable against the two real sample files this issue
// was filed with, without any React rendering involved.

export class CourseCsvParseError extends Error {}

// One row per hole; one tee configuration per distinct configuration_id;
// one course per file. Only these columns are load-bearing (grouping,
// naming, hole identity) -- course_id/configuration_id themselves are
// the source system's own ids, read only to group rows, never reused as
// this app's own ids (POST /courses generates its own, same as every
// other creation path).
const REQUIRED_COLUMNS = [
  "course_name",
  "configuration_id",
  "configuration_name",
  "hole_count",
  "hole_number",
  "distance_yards",
  "par",
  "stroke_index",
] as const;

export interface ParsedTeeConfigurationOutcome {
  configurationId: string;
  name: string;
  valid: boolean;
  // Populated when valid -- the exact payload shape POST /courses's
  // teeConfigurations[] accepts, already run through the same
  // teeConfigurationSchema a manual entry goes through.
  input?: TeeConfigurationInput;
  // Populated when !valid -- why this configuration is being skipped.
  reason?: string;
}

export interface ParsedCourseCsv {
  name: string;
  city?: string;
  country?: string;
  teeConfigurations: ParsedTeeConfigurationOutcome[];
}

interface RawRow {
  [column: string]: string | undefined;
}

// Mirrors react-hook-form's own register(..., { valueAsNumber: true })
// behaviour (a real <input type="number">'s .valueAsNumber is a number
// or NaN, never a string) -- teeConfigurationSchema's own numberOrUndefined
// preprocess only recognises "already a number (possibly NaN)", so a raw
// CSV cell (always a string) must be converted here first, the same way
// the DOM does it ahead of zod for the manual form. Blank -> undefined
// (a genuinely missing value, e.g. course_rating/slope_rating on the
// Llavaneras sample's own 9-hole "Members" config); non-blank -> Number()
// (NaN for non-numeric garbage, which teeConfigurationSchema already
// turns into the same "Enter a ..." message an empty manual field gets).
function csvNumberOrUndefined(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

function summarizeZodError(error: { issues: Array<{ message: string; path: PropertyKey[] }> }): string {
  const messages = error.issues.slice(0, 3).map((issue) => {
    // holes.<index>.<field> -> "Hole <n>: <message>", matching how the
    // manual form's own per-hole errors are already understood (1-based,
    // not the 0-based array index).
    if (issue.path[0] === "holes" && typeof issue.path[1] === "number") {
      return `Hole ${issue.path[1] + 1}: ${issue.message}`;
    }
    return issue.message;
  });
  const suffix = error.issues.length > messages.length ? ` (+${error.issues.length - messages.length} more)` : "";
  return messages.join("; ") + suffix;
}

// Combines configuration_name + tee_colour into one name, without the
// redundant "Blue Tee (Blue)" the Costa Brava sample would otherwise
// produce -- that file already bakes the colour into configuration_name
// ("Golf Costa Brava - Verde - Blue Tee (Male)"), while the Llavaneras
// sample's own configuration_name ("Members") doesn't mention colour at
// all. Only appends when the colour genuinely isn't already there.
function combineName(configurationName: string, teeColour: string | undefined): string {
  if (!teeColour) return configurationName;
  if (configurationName.toLowerCase().includes(teeColour.toLowerCase())) return configurationName;
  return `${configurationName} (${teeColour})`;
}

interface HoleRow {
  holeNumberRaw: string;
  holeNumber: number;
  distanceYards: number | undefined;
  par: number | undefined;
  strokeIndex: number | undefined;
}

function parseTeeConfigurationGroup(configurationId: string, rows: RawRow[]): ParsedTeeConfigurationOutcome {
  const first = rows[0]!;
  const name = combineName((first.configuration_name ?? "").trim(), first.tee_colour?.trim());
  const holeCountRaw = (first.hole_count ?? "").trim();

  const holeRows: HoleRow[] = rows.map((row) => {
    const holeNumberRaw = (row.hole_number ?? "").trim();
    return {
      holeNumberRaw,
      holeNumber: Number(holeNumberRaw),
      distanceYards: csvNumberOrUndefined(row.distance_yards),
      par: csvNumberOrUndefined(row.par),
      strokeIndex: csvNumberOrUndefined(row.stroke_index),
    };
  });

  // Hole-count/hole-number completeness is checked before handing off to
  // teeConfigurationSchema -- that schema (shared with manual entry, which
  // can never produce a gap, duplicate, or out-of-range hole via its own
  // UI) has no length/completeness check of its own, so a malformed CSV
  // needs its own, clearer message here instead of a confusing per-index
  // zod error, or worse, silently passing through (review finding, PR
  // #158: hole_count=9 with holes 1-18 present had no duplicates and no
  // gap in 1-9, so it previously passed straight through with 18 holes
  // in a supposedly-9-hole configuration). Every hole_number is now
  // checked against the valid 1..expectedCount range, not just checked
  // for internal duplicates/gaps -- out-of-range values (too many holes,
  // or a stray non-numeric value) are caught here, in range-check order,
  // before duplicates/gaps are even considered.
  const expectedCount = holeCountRaw === "9" ? 9 : holeCountRaw === "18" ? 18 : undefined;
  if (expectedCount !== undefined) {
    const seen = new Set<number>();
    for (const hole of holeRows) {
      if (!Number.isInteger(hole.holeNumber) || hole.holeNumber < 1 || hole.holeNumber > expectedCount) {
        return {
          configurationId,
          name,
          valid: false,
          reason: `invalid hole number '${hole.holeNumberRaw}' (must be an integer from 1 to ${expectedCount})`,
        };
      }
      if (seen.has(hole.holeNumber)) {
        return { configurationId, name, valid: false, reason: `duplicate hole number ${hole.holeNumber}` };
      }
      seen.add(hole.holeNumber);
    }
    const missing = Array.from({ length: expectedCount }, (_, index) => index + 1).filter((n) => !seen.has(n));
    if (missing.length > 0) {
      return { configurationId, name, valid: false, reason: `missing hole(s): ${missing.join(", ")}` };
    }
  }

  const candidate: TeeConfigurationFormInput = {
    name,
    // Not validated as "9" | "18" here -- an unrecognised value (e.g. an
    // empty cell, or something other than 9/18) is left as-is and caught
    // by teeConfigurationSchema's own z.enum(["9", "18"]) below, the same
    // "let the shared schema produce the message" approach as every
    // other field.
    holeCount: holeCountRaw as TeeConfigurationFormInput["holeCount"],
    courseRating: csvNumberOrUndefined(first.course_rating),
    slopeRating: csvNumberOrUndefined(first.slope_rating),
    holes: [...holeRows]
      .sort((a, b) => a.holeNumber - b.holeNumber)
      .map((hole) => ({ distanceYards: hole.distanceYards, par: hole.par, strokeIndex: hole.strokeIndex })),
  };

  const result = teeConfigurationSchema.safeParse(candidate);
  if (!result.success) {
    return { configurationId, name, valid: false, reason: summarizeZodError(result.error) };
  }
  return { configurationId, name, valid: true, input: toTeeConfigurationInput(result.data) };
}

export function parseCourseCsv(csvText: string): ParsedCourseCsv {
  const result = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    throw new CourseCsvParseError(`Couldn't parse this file: ${result.errors[0]!.message}.`);
  }

  const columns = result.meta.fields ?? [];
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missingColumns.length > 0) {
    throw new CourseCsvParseError(`Missing required column(s): ${missingColumns.join(", ")}.`);
  }

  const rows = result.data;
  if (rows.length === 0) {
    throw new CourseCsvParseError("This file has no data rows.");
  }

  const courseName = rows[0]!.course_name?.trim();
  if (!courseName) {
    throw new CourseCsvParseError("course_name is required.");
  }

  const rowsByConfig = new Map<string, RawRow[]>();
  for (const row of rows) {
    const configurationId = row.configuration_id?.trim();
    if (!configurationId) {
      throw new CourseCsvParseError("Every row must have a configuration_id -- found a row without one.");
    }
    const existing = rowsByConfig.get(configurationId);
    if (existing) {
      existing.push(row);
    } else {
      rowsByConfig.set(configurationId, [row]);
    }
  }

  if (rowsByConfig.size === 0) {
    throw new CourseCsvParseError("No tee configurations could be found in this file.");
  }

  const teeConfigurations = Array.from(rowsByConfig.entries()).map(([configurationId, groupRows]) =>
    parseTeeConfigurationGroup(configurationId, groupRows),
  );

  return {
    name: courseName,
    city: rows[0]!.course_city?.trim() || undefined,
    // Uppercased to match the manual form's own submit-time normalisation
    // (CreateCoursePage's values.country.toUpperCase()) -- both entry
    // modes must send the backend the same shape for the same input, not
    // let a lowercase CSV value ("us") slip through only through this
    // path (review finding, PR #158).
    country: rows[0]!.course_country?.trim().toUpperCase() || undefined,
    teeConfigurations,
  };
}
