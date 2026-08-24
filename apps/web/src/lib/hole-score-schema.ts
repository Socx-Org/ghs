import { z } from "zod";

// ghs#94/#160: strokes/putts validation shared between HoleEntryCard's
// own manual per-hole form and the round-entry CSV importer
// (round-hole-csv.ts). Extracted (not left local to HoleEntryCard.tsx)
// so the CSV path can reuse the exact same "what makes a stroke/putt
// count valid" rules, not a second copy that could drift from them.

// A blank/non-numeric input coerces to NaN, not undefined -- without
// this, z.number()'s own base type-check rejects NaN before .min()'s
// custom message ever runs, surfacing zod's generic "expected number,
// received NaN" instead (caught by HoleEntryCard's own test suite).
export const requiredStrokes = z.preprocess(
  (value) => (typeof value === "number" && Number.isNaN(value) ? undefined : value),
  z.number({ error: "Enter a stroke count" }).min(1, "Enter a stroke count"),
);

export const optionalNonNegative = z.preprocess(
  (value) => (typeof value === "number" && Number.isNaN(value) ? undefined : value),
  z.number().min(0).optional(),
);

// ghs#160: the CSV-import counterpart to HoleEntryCard's own
// holeFormSchema -- genuinely optional gir/fairwayResult/inSand/
// penalties (undefined = "leave this field alone," matching
// addHoleScore's own upsert semantics and this issue's explicit CSV
// format spec), unlike holeFormSchema's, where gir/inSand/penalties are
// always-defined because a checkbox/number input in the manual form
// always has a concrete value to submit. Deliberately a separate schema,
// not a relaxation of holeFormSchema itself -- widening penalties there
// to "optional, omit if blank" would silently change the manual form's
// own existing behaviour (today, clearing the penalties field and
// saving records 0, not "leave whatever was already there alone"),
// which is out of this issue's scope.
export const csvHoleRowSchema = z.object({
  strokes: requiredStrokes,
  putts: optionalNonNegative,
  gir: z.boolean().optional(),
  fairwayResult: z.enum(["hit", "missed_left", "missed_right"]).optional(),
  inSand: z.boolean().optional(),
  penalties: optionalNonNegative,
});
export type CsvHoleRowOutput = z.output<typeof csvHoleRowSchema>;
