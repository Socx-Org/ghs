import Papa from "papaparse";
import { checkHoleNumberCompleteness } from "./csv-hole-completeness";
import { csvNumberOrUndefined } from "./csv-number";
import type { TeeConfigurationFormInput } from "./tee-configuration-schema";

// ghs#229: TeeConfigurationForm's CSV-import alternative for HOLES only
// -- configuration_name/tee_colour/hole_count/course_rating/slope_rating
// stay as the form's own existing fields, entered once, not repeated per
// row the way ghs#155's course-creation CSV format does (and risks
// disagreeing with itself across rows, since that importer silently
// takes the first row's values for those). Closest existing precedent
// is ghs#160's round-hole-csv.ts: holeCount is a parameter here too
// (the form's own already-chosen 9/18 Select value), not a CSV column,
// since the identity this file's rows belong to already lives outside
// it.
//
// Deliberately throws on a STRUCTURAL problem (bad/duplicate/missing
// hole numbers) rather than round-hole-csv.ts's own per-row valid/
// skipped outcome list -- that per-row model fits round holes because
// each one is its own independent API call there; a tee configuration's
// holes are submitted as ONE combined payload (teeConfigurationSchema),
// so a structural gap can't be "skipped," it has to block the whole
// import. An individual bad VALUE (a non-numeric par, a negative
// distance) is deliberately NOT checked here, though -- left as
// `undefined` (csvNumberOrUndefined, same convention every CSV parser
// in this app already uses) for the existing shared teeConfigurationSchema
// to catch once populated into the form's own holes table, exactly as a
// manual entry's own blank/bad field already does; duplicating that
// per-field validation here would be a second, divergence-prone copy of
// rules the form already enforces.
export class TeeConfigurationHolesCsvParseError extends Error {}

const REQUIRED_COLUMNS = ["hole_number", "distance_yards", "par", "stroke_index"] as const;

interface RawRow {
  [column: string]: string | undefined;
}

export function parseTeeConfigurationHolesCsv(csvText: string, expectedHoleCount: 9 | 18): TeeConfigurationFormInput["holes"] {
  const result = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    throw new TeeConfigurationHolesCsvParseError(`Couldn't parse this file: ${result.errors[0]!.message}.`);
  }

  const columns = result.meta.fields ?? [];
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missingColumns.length > 0) {
    throw new TeeConfigurationHolesCsvParseError(`Missing required column(s): ${missingColumns.join(", ")}.`);
  }

  const rows = result.data;
  if (rows.length === 0) {
    throw new TeeConfigurationHolesCsvParseError("This file has no data rows.");
  }

  const holeRows = rows.map((row) => {
    const holeNumberRaw = (row.hole_number ?? "").trim();
    return {
      holeNumberRaw,
      holeNumber: Number(holeNumberRaw),
      distanceYards: csvNumberOrUndefined(row.distance_yards),
      par: csvNumberOrUndefined(row.par),
      strokeIndex: csvNumberOrUndefined(row.stroke_index),
    };
  });

  const reason = checkHoleNumberCompleteness(
    holeRows.map((hole) => ({ raw: hole.holeNumberRaw, value: hole.holeNumber })),
    expectedHoleCount,
  );
  if (reason) {
    throw new TeeConfigurationHolesCsvParseError(`Invalid hole numbers: ${reason}.`);
  }

  return [...holeRows]
    .sort((a, b) => a.holeNumber - b.holeNumber)
    .map((hole) => ({ distanceYards: hole.distanceYards, par: hole.par, strokeIndex: hole.strokeIndex }));
}
