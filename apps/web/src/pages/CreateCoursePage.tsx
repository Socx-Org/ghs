import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, BackButton, Button, CourseCsvImportForm, FormField, Input, ToggleGroup } from "../components";
import type { CourseCsvImportSubmitValue } from "../components";
import { ApiError, createCourse } from "../lib/api";

// ghs#110: create-course form -- design doc section 6.2. POST /courses
// already existed (ghs#94's tee-configuration lookups needed it); this
// is its first real create-a-course caller. No club field -- club
// management is explicit non-scope for this issue, and no clubs
// picker/creation UI exists anywhere in this app. No tee-configuration
// fields in the manual form -- deliberately deferred to #112 (Tee
// Configuration management), which owns the one real tee-configuration
// UI component this app will have; building a second, throwaway version
// of that here would be exactly the duplication the design doc's own
// "do not duplicate tee configuration UI patterns across unrelated
// screens" instruction (quoted in #112's own scope) warns against. A
// course can be created with zero tee configurations and have them
// added afterward via #112's screen.
//
// ghs#155: a second entry mode, "Load from CSV" -- parses a course + its
// tee configuration(s)/holes from an uploaded file and submits them via
// this same POST /courses call, populating teeConfigurations[] (which
// the manual form above still never does, unchanged). CourseCsvImportForm
// owns its own parse-preview-submit flow; this page just switches which
// one is rendered and performs the actual navigation on success, same
// division of responsibility as every other onSubmit-callback form here.

const createCourseSchema = z.object({
  // .trim() before .min() -- a whitespace-only value must fail client-
  // side validation with the same message an empty one does, not pass
  // here and then trim down to "" at submit time, which the backend
  // would reject anyway (review finding, PR #132).
  name: z.string().trim().min(1, "Course name is required"),
  city: z.string().optional(),
  country: z
    .string()
    .optional()
    .refine((value) => !value || /^[a-zA-Z]{2}$/.test(value), "Country must be a 2-letter code, e.g. US"),
});
type CreateCourseFormValues = z.infer<typeof createCourseSchema>;

type EntryMode = "manual" | "csv";

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function ManualEntryForm({ onCreated }: { onCreated: (courseId: string) => void }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCourseFormValues>({ resolver: zodResolver(createCourseSchema) });

  async function onSubmit(values: CreateCourseFormValues) {
    setFeedback(null);
    try {
      const course = await createCourse({
        name: values.name,
        city: values.city?.trim() || undefined,
        country: values.country ? values.country.toUpperCase() : undefined,
      });
      onCreated(course.id);
    } catch (error) {
      setFeedback(describeError(error, "Something went wrong. Please try again."));
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {feedback && <Alert variant="error">{feedback}</Alert>}

      <FormField label="Course name" error={errors.name?.message}>
        <Input type="text" autoComplete="off" {...register("name")} />
      </FormField>

      <FormField label="City" error={errors.city?.message}>
        <Input type="text" autoComplete="off" {...register("city")} />
      </FormField>

      <FormField label="Country" helpText="2-letter code, e.g. US, GB, ES." error={errors.country?.message}>
        <Input type="text" autoComplete="off" maxLength={2} {...register("country")} />
      </FormField>

      <Button type="submit" isLoading={isSubmitting} className="w-full">
        Create course
      </Button>
    </form>
  );
}

export default function CreateCoursePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<EntryMode>("manual");

  async function handleCsvSubmit(value: CourseCsvImportSubmitValue) {
    const course = await createCourse(value);
    navigate(`/courses/${course.id}`);
  }

  return (
    <div className={mode === "csv" ? "mx-auto w-full max-w-2xl px-4 py-12" : "mx-auto w-full max-w-lg px-4 py-12"}>
      <BackButton onClick={() => navigate("/courses")} />
      <h1 className="mt-4 text-2xl font-semibold text-text">Create course</h1>
      <p className="mt-2 text-sm text-text-muted">
        {mode === "manual" ? "Add a new golf course. Tee configurations can be added afterward." : "Import a course and its tee configurations from a CSV file."}
      </p>

      <fieldset className="mt-6 mb-2 flex items-center gap-2 border-0 p-0">
        <legend className="text-sm text-text-muted">How do you want to add this course?</legend>
        <ToggleGroup
          name="create-course-mode"
          value={mode}
          onChange={(next) => {
            if (next === "manual" || next === "csv") setMode(next);
          }}
          options={[
            { value: "manual", label: "Enter manually" },
            { value: "csv", label: "Load from CSV" },
          ]}
        />
      </fieldset>

      <div className="mt-6">
        {mode === "manual" ? (
          <ManualEntryForm onCreated={(courseId) => navigate(`/courses/${courseId}`)} />
        ) : (
          <CourseCsvImportForm onSubmit={handleCsvSubmit} />
        )}
      </div>
    </div>
  );
}
