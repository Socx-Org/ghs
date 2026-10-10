import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Save } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert } from "../Alert";
import { Button } from "../Button";
import { FormField } from "../FormField";
import { Input } from "../Input";
import { Select } from "../Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "../Table";
import { ToggleGroup } from "../ToggleGroup";
import { emptyHole, teeConfigurationSchema, toTeeConfigurationInput } from "../../lib/tee-configuration-schema";
import type { TeeConfigurationFormInput, TeeConfigurationFormOutput } from "../../lib/tee-configuration-schema";
import { TeeConfigurationHolesCsvParseError, parseTeeConfigurationHolesCsv } from "../../lib/tee-configuration-holes-csv";
import type { TeeConfiguration, TeeConfigurationInput } from "../../types/domain";

// ghs#112: the one real tee-configuration create/edit form this app
// has -- used both for adding a new tee configuration to an existing
// course and for editing one, from CourseDetailPage's Tee
// Configurations section. Per the design doc's own "do not duplicate
// tee configuration UI patterns across unrelated screens" instruction
// (already quoted in this issue) -- there is deliberately no second
// copy of this anywhere (ghs#110's create-course form has no tee-
// configuration fields at all, by design -- see that issue's own PR).
//
// ghs#155: the actual validation schema/conversion (teeConfigurationSchema,
// toTeeConfigurationInput) now lives in lib/tee-configuration-schema.ts,
// not here -- so the Create Course CSV importer (lib/course-csv.ts) can
// validate a CSV-parsed tee configuration through the exact same rules a
// manual entry goes through, without a component file needing to export a
// plain schema/function alongside its component (which breaks Fast
// Refresh).
//
// ghs#229: a second HOLES entry mode, "Load from CSV" -- name/holeCount/
// courseRating/slopeRating stay as real form fields either way (resolved
// with the user: NOT repeated per CSV row, unlike ghs#155's course-level
// importer). A successful parse just calls the same `replace()` the
// holeCount-resize effect below already uses, so this table doubles as
// both the CSV preview AND the final, directly-correctable holes data --
// no second, parallel read-only preview list needed, unlike
// CourseCsvImportForm/RoundHoleCsvImportForm (those each juggle several
// tee configurations/holes with independent per-row outcomes; this form
// only ever has the one set of holes already on screen).

function toDefaultValues(initialValues: TeeConfiguration | undefined): TeeConfigurationFormInput {
  if (!initialValues) {
    return { name: "", holeCount: "18", courseRating: undefined, slopeRating: undefined, holes: Array.from({ length: 18 }, emptyHole) };
  }
  return {
    name: initialValues.name,
    holeCount: initialValues.holeCount === 9 ? "9" : "18",
    courseRating: initialValues.courseRating,
    slopeRating: initialValues.slopeRating,
    holes: Array.from({ length: initialValues.holeCount }, (_, index) => {
      const hole = initialValues.holes.find((h) => h.holeNumber === index + 1);
      return hole
        ? { distanceYards: hole.distanceYards, par: hole.par, strokeIndex: hole.strokeIndex }
        : emptyHole();
    }),
  };
}

export interface TeeConfigurationFormProps {
  // undefined = create mode (a new tee configuration on the given
  // course); provided = edit mode, pre-filled from the real existing
  // record.
  initialValues?: TeeConfiguration;
  onSubmit: (input: TeeConfigurationInput) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

export function TeeConfigurationForm({ initialValues, onSubmit, onCancel, submitLabel }: TeeConfigurationFormProps) {
  const {
    register,
    handleSubmit,
    control,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<TeeConfigurationFormInput, unknown, TeeConfigurationFormOutput>({
    resolver: zodResolver(teeConfigurationSchema),
    defaultValues: toDefaultValues(initialValues),
  });

  const { fields, replace } = useFieldArray({ control, name: "holes" });
  const holeCount = useWatch({ control, name: "holeCount" });

  // Resizes the holes array to match holeCount whenever it changes --
  // preserves already-entered rows within the new range, adds empty
  // ones for the rest. Reads live values via getValues(), not the
  // `fields` snapshot: fields' own per-field values only reflect the
  // defaults from the last structural mutation (append/remove/replace)
  // -- a plain register()'d (uncontrolled) input's actual typed value
  // never flows back into it, so reading fields[index] here would
  // silently discard whatever the admin had already entered (caught by
  // this component's own test). Deliberately excludes `fields`/
  // `getValues` from the dependency list -- this must only re-run when
  // the admin actually changes holeCount.
  useEffect(() => {
    const count = Number(holeCount);
    const current = getValues("holes");
    if (count === current.length) return;
    replace(Array.from({ length: count }, (_, index) => current[index] ?? emptyHole()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeCount]);

  async function submit(values: TeeConfigurationFormOutput) {
    await onSubmit(toTeeConfigurationInput(values));
  }

  const holesHaveErrors = Boolean(errors.holes);

  // ghs#229: component-local, independent of react-hook-form -- which
  // mode is selected has no effect on the schema/submit path at all,
  // only on how the SAME `holes` field array gets populated.
  const [holesEntryMode, setHolesEntryMode] = useState<"manual" | "csv">("manual");
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCsvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setCsvError(null);
    if (!file) return;
    try {
      const text = await file.text();
      // holeCount is already a real, validated 9|18 by this point --
      // it's a <Select> with only those two <option>s, never free text.
      const parsedHoles = parseTeeConfigurationHolesCsv(text, Number(holeCount) as 9 | 18);
      replace(parsedHoles);
    } catch (error) {
      setCsvError(error instanceof TeeConfigurationHolesCsvParseError ? error.message : "Couldn't read this file. Try again.");
      // Deliberately does NOT replace() the holes array on failure --
      // a bad upload must never clobber whatever was already there
      // (matching CourseCsvImportForm/RoundHoleCsvImportForm's own
      // "leave existing state untouched on a failed parse" convention).
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(submit)} noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Name" error={errors.name?.message}>
          <Input type="text" autoComplete="off" {...register("name")} />
        </FormField>

        <FormField label="Holes">
          <Select {...register("holeCount")}>
            <option value="9">9</option>
            <option value="18">18</option>
          </Select>
        </FormField>

        <FormField label="Course rating" error={errors.courseRating?.message}>
          <Input type="number" step="0.1" inputMode="decimal" {...register("courseRating", { valueAsNumber: true })} />
        </FormField>

        <FormField label="Slope rating" helpText="55-155." error={errors.slopeRating?.message}>
          <Input type="number" step="1" inputMode="numeric" {...register("slopeRating", { valueAsNumber: true })} />
        </FormField>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-text">Holes</h3>
          <ToggleGroup
            name="holes-entry-mode"
            value={holesEntryMode}
            onChange={(next) => {
              if (next === "manual" || next === "csv") setHolesEntryMode(next);
            }}
            options={[
              { value: "manual", label: "Enter manually" },
              { value: "csv", label: "Load from CSV" },
            ]}
          />
        </div>

        {holesEntryMode === "csv" && (
          <div className="mb-4">
            <FormField label="CSV file" helpText="One row per hole -- hole_number, distance_yards, par, stroke_index.">
              <Input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} />
            </FormField>
            {csvError && (
              <Alert variant="error" className="mt-2">
                {csvError}
              </Alert>
            )}
          </div>
        )}

        {holesHaveErrors && <Alert variant="error">Check the highlighted hole fields below -- distance, par, and stroke index are all required.</Alert>}
        <Table className="mt-2">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Hole</TableHeaderCell>
              <TableHeaderCell>Yards</TableHeaderCell>
              <TableHeaderCell>Par</TableHeaderCell>
              <TableHeaderCell>Stroke index</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {fields.map((field, index) => {
              const holeErrors = errors.holes?.[index];
              return (
                <TableRow key={field.id}>
                  <TableCell className="font-medium">{index + 1}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      inputMode="numeric"
                      aria-label={`Hole ${index + 1} distance in yards`}
                      invalid={Boolean(holeErrors?.distanceYards)}
                      className="w-24"
                      {...register(`holes.${index}.distanceYards`, { valueAsNumber: true })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      inputMode="numeric"
                      aria-label={`Hole ${index + 1} par`}
                      invalid={Boolean(holeErrors?.par)}
                      className="w-20"
                      {...register(`holes.${index}.par`, { valueAsNumber: true })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      inputMode="numeric"
                      aria-label={`Hole ${index + 1} stroke index`}
                      invalid={Boolean(holeErrors?.strokeIndex)}
                      className="w-20"
                      {...register(`holes.${index}.strokeIndex`, { valueAsNumber: true })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          // ghs#134: a Save icon only in edit mode -- submitLabel reads
          // "Save changes" there, matching CourseDetailPage's own course-
          // edit form; create mode's "Add tee configuration" is a
          // different action class (see that page's own icon-audit
          // notes) and stays icon-free, consistent with every other
          // form-submit "Create X" button in the app.
          icon={initialValues ? <Save aria-hidden="true" className="h-4 w-4" /> : undefined}
          isLoading={isSubmitting}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
