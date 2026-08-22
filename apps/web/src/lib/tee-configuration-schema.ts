import { z } from "zod";
import type { TeeConfigurationInput } from "../types/domain";

// ghs#112's own validation rules, extracted out of TeeConfigurationForm.tsx
// (ghs#155 review requirement -- a component file exporting a plain
// schema/function alongside its component breaks Fast Refresh,
// react-refresh/only-export-components, same reasoning already applied
// to lib/domain-labels.ts for RoleBadge/AccountStatusBadge/RoundStatusBadge).
// This is the single source of "what makes a tee configuration valid" --
// both the manual TeeConfigurationForm and the CSV importer
// (lib/course-csv.ts) validate through this exact schema, so neither can
// silently drift from the other.

// Same NaN-from-empty-input coercion as HoleEntryCard's own preprocess
// pattern (ghs#94) -- register(..., { valueAsNumber: true }) turns an
// empty numeric input into NaN, not undefined, so z.number()'s own base
// check must be preceded by this or every empty field fails with zod's
// generic "expected number, received nan" instead of a real message. CSV
// import (lib/course-csv.ts) reuses this same handling for its own
// string-to-number conversion of blank cells.
export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isNaN(value) ? undefined : (value as number | undefined);
}

const holeSchema = z.object({
  distanceYards: z.preprocess(numberOrUndefined, z.number({ error: "Enter a distance" }).min(1, "Enter a distance")),
  par: z.preprocess(numberOrUndefined, z.number({ error: "Enter a par" }).min(3, "Par must be 3-6").max(6, "Par must be 3-6")),
  strokeIndex: z.preprocess(
    numberOrUndefined,
    z.number({ error: "Enter a stroke index" }).min(1, "Stroke index must be 1-18").max(18, "Stroke index must be 1-18"),
  ),
});

export const teeConfigurationSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  holeCount: z.enum(["9", "18"]),
  courseRating: z.preprocess(numberOrUndefined, z.number({ error: "Enter a course rating" }).min(0.1, "Enter a course rating")),
  slopeRating: z.preprocess(
    numberOrUndefined,
    z.number({ error: "Enter a slope rating" }).min(55, "Slope rating must be 55-155").max(155, "Slope rating must be 55-155"),
  ),
  holes: z.array(holeSchema),
});

// 3-generic useForm, same reasoning as HoleEntryCard's own equivalent
// comment: z.preprocess makes the schema's input type (raw, pre-
// coercion -- what register/defaultValues deal in) diverge from its
// output type (fully numeric, what handleSubmit's callback receives once
// zodResolver has actually run). A single TFieldValues generic can't
// express both.
export type TeeConfigurationFormInput = z.input<typeof teeConfigurationSchema>;
export type TeeConfigurationFormOutput = z.output<typeof teeConfigurationSchema>;

export function emptyHole(): TeeConfigurationFormInput["holes"][number] {
  return { distanceYards: undefined, par: undefined, strokeIndex: undefined };
}

export function toTeeConfigurationInput(values: TeeConfigurationFormOutput): TeeConfigurationInput {
  return {
    name: values.name,
    holeCount: Number(values.holeCount) as 9 | 18,
    courseRating: values.courseRating,
    slopeRating: values.slopeRating,
    holes: values.holes.map((hole, index) => ({ holeNumber: index + 1, ...hole })),
  };
}
