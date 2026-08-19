import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "../Alert";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Checkbox } from "../Checkbox";
import { FormField } from "../FormField";
import { Input } from "../Input";
import { ToggleGroup } from "../ToggleGroup";
import { useToast } from "../useToast";
import { ApiError, addHoleScore } from "../../lib/api";
import type { HoleScore } from "../../types/domain";

// ghs#94: one hole, one independent form -- the epic's own acceptance
// criterion ("incremental... explicit save states, not atomic save-
// everything-at-the-end"). This form always represents the *complete*
// current state of the hole (seeded from the existing score when one
// exists), so every save sends every field -- there's no partial-field
// concern to manage client-side. A blank optional numeric field means
// "no value in this form," which the real API (ghs#92/#93) treats as
// "leave whatever was already recorded alone," not "clear it" -- the
// backend has no explicit-clear capability for these fields at all, so
// this UI doesn't pretend to offer one either.

const NOT_RECORDED = "";

const optionalNonNegative = z.preprocess(
  (value) => (typeof value === "number" && Number.isNaN(value) ? undefined : value),
  z.number().min(0).optional(),
);

const requiredStrokes = z.preprocess(
  // A blank/non-numeric input coerces to NaN, not undefined -- without
  // this, z.number()'s own base type-check rejects NaN before .min()'s
  // custom message ever runs, surfacing zod's generic "expected number,
  // received NaN" instead (caught by this component's own test suite).
  (value) => (typeof value === "number" && Number.isNaN(value) ? undefined : value),
  z.number({ error: "Enter a stroke count" }).min(1, "Enter a stroke count"),
);

const holeFormSchema = z.object({
  strokes: requiredStrokes,
  putts: optionalNonNegative,
  gir: z.boolean(),
  fairwayResult: z.enum(["", "hit", "missed_left", "missed_right"]),
  inSand: z.boolean(),
  penalties: z.preprocess((value) => (typeof value === "number" && Number.isNaN(value) ? 0 : value), z.number().min(0)),
});
type HoleFormValues = z.infer<typeof holeFormSchema>;

export interface HoleEntryCardProps {
  roundId: string;
  holeNumber: number;
  par: number;
  strokeIndex: number;
  existingScore: HoleScore | undefined;
  disabled: boolean;
}

export function HoleEntryCard({ roundId, holeNumber, par, strokeIndex, existingScore, disabled }: HoleEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { show } = useToast();

  // 3-generic useForm: z.preprocess (requiredStrokes/optionalNonNegative
  // above) makes the schema's input type (raw, pre-coercion) diverge
  // from its output type (HoleFormValues, fully numeric) -- RHF's field
  // values must match the *input* side (what register/defaultValues
  // deal in), while handleSubmit's callback receives the *output* side
  // once zodResolver has actually run. A single TFieldValues generic
  // can't express both (caught by `tsc -b`, stricter than this app's
  // --noEmit typecheck).
  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.input<typeof holeFormSchema>, unknown, HoleFormValues>({
    resolver: zodResolver(holeFormSchema),
    defaultValues: {
      strokes: existingScore?.strokes,
      putts: existingScore?.putts ?? undefined,
      gir: existingScore?.gir ?? false,
      fairwayResult: existingScore?.fairwayResult ?? NOT_RECORDED,
      inSand: existingScore?.inSand ?? false,
      penalties: existingScore?.penalties ?? 0,
    },
  });

  const saveMutation = useMutation({
    mutationFn: (values: HoleFormValues) =>
      addHoleScore(roundId, {
        holeNumber,
        strokes: values.strokes,
        putts: values.putts,
        gir: values.gir,
        fairwayResult: values.fairwayResult === NOT_RECORDED ? undefined : values.fairwayResult,
        inSand: values.inSand,
        penalties: values.penalties,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rounds", roundId] });
      show({ variant: "success", message: `Hole ${holeNumber} saved.`, duration: 2500 });
    },
  });

  async function onSubmit(values: HoleFormValues) {
    setFeedback(null);
    try {
      await saveMutation.mutateAsync(values);
      // Marks these just-submitted values as the new clean baseline --
      // without this, isDirty (used below to decide whether "Saved"
      // still accurately describes the form) would stay true forever
      // after the very first edit, since RHF only compares against the
      // defaultValues captured at mount, not the round query's refetched
      // data (review finding, PR #95).
      reset(values);
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Couldn't save this hole. Try again.");
    }
  }

  const fairwayResult = useWatch({ control, name: "fairwayResult" });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-page text-sm font-semibold text-text">
            {holeNumber}
          </span>
          <div className="text-sm text-text-muted">
            Par {par} · Stroke index {strokeIndex}
          </div>
        </div>
        {/* Reflects whether the *current* form state matches what's
            persisted, not just "was this hole ever saved" (review
            finding, PR #95) -- editing an already-saved hole must not
            keep claiming "Saved" once the visible values have diverged
            from the server's copy. */}
        {existingScore && (isDirty ? <Badge variant="warning">Unsaved changes</Badge> : <Badge variant="success">Saved</Badge>)}
      </div>

      <form className="mt-3 flex flex-col gap-3" onSubmit={handleSubmit(onSubmit)} noValidate>
        {feedback && <Alert variant="error">{feedback}</Alert>}

        <FormField label="Strokes" error={errors.strokes?.message} className="max-w-[10rem]">
          <Input type="number" inputMode="numeric" min={1} disabled={disabled} {...register("strokes", { valueAsNumber: true })} />
        </FormField>

        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((current) => !current)} className="self-start">
          {expanded ? "Hide details" : "Add more details"}
        </Button>

        {expanded && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <FormField label="Putts" error={errors.putts?.message} className="max-w-[10rem]">
              <Input type="number" inputMode="numeric" min={0} disabled={disabled} {...register("putts", { valueAsNumber: true })} />
            </FormField>

            <FormField label="Penalties" error={errors.penalties?.message} className="max-w-[10rem]">
              <Input type="number" inputMode="numeric" min={0} disabled={disabled} {...register("penalties", { valueAsNumber: true })} />
            </FormField>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-text">Fairway</span>
              <ToggleGroup
                name={`fairway-${roundId}-${holeNumber}`}
                value={fairwayResult}
                onChange={(value) => setValue("fairwayResult", value as HoleFormValues["fairwayResult"])}
                disabled={disabled}
                options={[
                  { value: NOT_RECORDED, label: "Not recorded" },
                  { value: "hit", label: "Hit" },
                  { value: "missed_left", label: "Left" },
                  { value: "missed_right", label: "Right" },
                ]}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-text">
              <Checkbox disabled={disabled} {...register("gir")} />
              Green in regulation
            </label>

            <label className="flex items-center gap-2 text-sm text-text">
              <Checkbox disabled={disabled} {...register("inSand")} />
              In sand
            </label>
          </div>
        )}

        <Button type="submit" variant="secondary" size="sm" isLoading={isSubmitting} disabled={disabled} className="self-start">
          Save hole
        </Button>
      </form>
    </div>
  );
}
