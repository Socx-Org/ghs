import { useEffect } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert } from "../Alert";
import { Button } from "../Button";
import { FormField } from "../FormField";
import { Input } from "../Input";
import { Select } from "../Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "../Table";
import type { TeeConfiguration, TeeConfigurationInput } from "../../types/domain";

// ghs#112: the one real tee-configuration create/edit form this app
// has -- used both for adding a new tee configuration to an existing
// course and for editing one, from CourseDetailPage's Tee
// Configurations section. Per the design doc's own "do not duplicate
// tee configuration UI patterns across unrelated screens" instruction
// (already quoted in this issue) -- there is deliberately no second
// copy of this anywhere (ghs#110's create-course form has no tee-
// configuration fields at all, by design -- see that issue's own PR).

// Same NaN-from-empty-input coercion as HoleEntryCard's own preprocess
// pattern (ghs#94) -- register(..., { valueAsNumber: true }) turns an
// empty numeric input into NaN, not undefined, so z.number()'s own
// base check must be preceded by this or every empty field fails with
// zod's generic "expected number, received nan" instead of a real
// message.
function numberOrUndefined(value: unknown): number | undefined {
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

const teeConfigurationSchema = z.object({
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
// output type (fully numeric, what handleSubmit's callback receives
// once zodResolver has actually run). A single TFieldValues generic
// can't express both.
type TeeConfigurationFormInput = z.input<typeof teeConfigurationSchema>;
type TeeConfigurationFormOutput = z.output<typeof teeConfigurationSchema>;

function emptyHole(): TeeConfigurationFormInput["holes"][number] {
  return { distanceYards: undefined, par: undefined, strokeIndex: undefined };
}

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

function toInput(values: TeeConfigurationFormOutput): TeeConfigurationInput {
  return {
    name: values.name,
    holeCount: Number(values.holeCount) as 9 | 18,
    courseRating: values.courseRating,
    slopeRating: values.slopeRating,
    holes: values.holes.map((hole, index) => ({ holeNumber: index + 1, ...hole })),
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
    await onSubmit(toInput(values));
  }

  const holesHaveErrors = Boolean(errors.holes);

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
        <h3 className="mb-2 text-sm font-medium text-text">Holes</h3>
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
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
