import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, FormField, Input } from "../components";
import { ApiError, createCourse } from "../lib/api";

// ghs#110: create-course form -- design doc section 6.2. POST /courses
// already existed (ghs#94's tee-configuration lookups needed it); this
// is its first real create-a-course caller. No club field -- club
// management is explicit non-scope for this issue, and no clubs
// picker/creation UI exists anywhere in this app. No tee-configuration
// fields here either, despite POST /courses accepting a nested
// teeConfigurations[] array -- deliberately deferred to #112 (Tee
// Configuration management), which owns the one real tee-configuration
// UI component this app will have; building a second, throwaway version
// of that here would be exactly the duplication the design doc's own
// "do not duplicate tee configuration UI patterns across unrelated
// screens" instruction (quoted in #112's own scope) warns against. A
// course can be created with zero tee configurations and have them
// added afterward via #112's screen.

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

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function CreateCoursePage() {
  const navigate = useNavigate();
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
      navigate(`/courses/${course.id}`);
    } catch (error) {
      setFeedback(describeError(error, "Something went wrong. Please try again."));
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12">
      <Button variant="ghost" size="sm" onClick={() => navigate("/courses")}>
        ← Back
      </Button>
      <h1 className="mt-4 text-2xl font-semibold text-text">Create course</h1>
      <p className="mt-2 text-sm text-text-muted">Add a new golf course. Tee configurations can be added afterward.</p>

      <form className="mt-8 flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
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
    </div>
  );
}
