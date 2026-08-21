import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Card, CardBody, CardHeader, FormField, Input, Modal, Skeleton, TeeConfigurationForm, useToast } from "../components";
import { ApiError, createTeeConfiguration, deleteTeeConfiguration, getCourse, updateCourse, updateTeeConfiguration } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type { Course, TeeConfiguration, TeeConfigurationInput } from "../types/domain";

// ghs#110: course detail/edit screen -- design doc section 6.4.
//
// ghs#112: the Tee Configurations section below now owns real list/
// create/update/delete actions, built on the one shared
// TeeConfigurationForm component (components/domain) -- per the design
// doc's own "do not duplicate tee configuration UI patterns across
// unrelated screens" instruction. #110's create-course form
// deliberately has no tee-configuration fields of its own for exactly
// this reason (see that issue's PR) -- this is the only place a tee
// configuration is ever created, edited, or removed.
//
// Reachable by every authenticated role (matches GET /courses/:id
// having no role restriction, same reasoning as #109's course list) --
// only the edit form/tee-configuration actions are admin-gated; a non-
// admin sees the same read-only info a course list entry already
// implied existed.

const updateCourseSchema = z.object({
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
type UpdateCourseFormValues = z.infer<typeof updateCourseSchema>;

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function locationLine(course: Pick<Course, "city" | "country">): string | null {
  if (course.city && course.country) return `${course.city}, ${course.country}`;
  return course.city ?? course.country ?? null;
}

function CourseEditForm({ course }: { course: Course }) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ variant: "success" | "error"; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateCourseFormValues>({
    resolver: zodResolver(updateCourseSchema),
    defaultValues: { name: course.name, city: course.city ?? "", country: course.country ?? "" },
  });

  async function onSubmit(values: UpdateCourseFormValues) {
    setFeedback(null);
    try {
      await updateCourse(course.id, {
        name: values.name,
        city: values.city?.trim() || null,
        country: values.country ? values.country.toUpperCase() : null,
      });
      queryClient.invalidateQueries({ queryKey: ["courses", course.id] });
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      setFeedback({ variant: "success", message: "Course updated." });
    } catch (error) {
      setFeedback({ variant: "error", message: describeError(error, "Something went wrong. Please try again.") });
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {feedback && <Alert variant={feedback.variant}>{feedback.message}</Alert>}

      <FormField label="Course name" error={errors.name?.message}>
        <Input type="text" autoComplete="off" {...register("name")} />
      </FormField>

      <FormField label="City" error={errors.city?.message}>
        <Input type="text" autoComplete="off" {...register("city")} />
      </FormField>

      <FormField label="Country" helpText="2-letter code, e.g. US, GB, ES." error={errors.country?.message}>
        <Input type="text" autoComplete="off" maxLength={2} {...register("country")} />
      </FormField>

      <Button type="submit" isLoading={isSubmitting} className="w-full sm:w-auto">
        Save changes
      </Button>
    </form>
  );
}

function CourseReadOnlyView({ course }: { course: Course }) {
  return (
    <dl className="flex flex-col gap-4">
      <div>
        <dt className="text-xs font-medium text-text-muted">Name</dt>
        <dd className="text-sm text-text">{course.name}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-text-muted">Location</dt>
        <dd className="text-sm text-text">{locationLine(course) ?? "—"}</dd>
      </div>
    </dl>
  );
}

// ghs#112/#99. "tee_configuration_has_rounds" is the backend's own
// stable code, not human copy -- same convention as
// describeDeleteError (course delete, #111).
function describeTeeDeleteError(error: unknown): string {
  if (error instanceof ApiError && error.message === "tee_configuration_has_rounds") {
    return "This tee configuration can't be deleted because it has rounds recorded against it.";
  }
  return describeError(error, "Couldn't delete the tee configuration. Try again.");
}

function TeeConfigurationsSection({ course, isAdmin }: { course: Course; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTee, setEditingTee] = useState<TeeConfiguration | null>(null);
  const [deletingTee, setDeletingTee] = useState<TeeConfiguration | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["courses", course.id] });
    queryClient.invalidateQueries({ queryKey: ["courses"] });
  }

  const createMutation = useMutation({
    mutationFn: (input: TeeConfigurationInput) => createTeeConfiguration(course.id, input),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      show({ variant: "success", message: "Tee configuration added.", duration: 2500 });
    },
    onError: (error) => {
      show({ variant: "error", message: describeError(error, "Couldn't add the tee configuration. Try again.") });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: TeeConfigurationInput) => updateTeeConfiguration(editingTee!.id, input),
    onSuccess: () => {
      invalidate();
      setEditingTee(null);
      show({ variant: "success", message: "Tee configuration updated.", duration: 2500 });
    },
    onError: (error) => {
      show({ variant: "error", message: describeError(error, "Couldn't update the tee configuration. Try again.") });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTeeConfiguration(deletingTee!.id),
    onSuccess: () => {
      invalidate();
      setDeletingTee(null);
      show({ variant: "success", message: "Tee configuration deleted.", duration: 2500 });
    },
    onError: (error) => {
      // Deliberately doesn't close the modal here -- same convention as
      // course delete (#111): the admin can see the toast and decide to
      // cancel or retry from the still-open confirmation.
      show({ variant: "error", message: describeTeeDeleteError(error) });
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">Tee configurations</h2>
        {isAdmin && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Add tee configuration
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {course.teeConfigurations.length === 0 ? (
          <p className="text-sm text-text-muted">No tee configurations yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {course.teeConfigurations.map((tee) => (
              <li key={tee.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <span className="text-sm font-medium text-text">{tee.name}</span>
                  <p className="text-xs text-text-muted">
                    {tee.holeCount} holes · rating {tee.courseRating.toFixed(1)} · slope {tee.slopeRating}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingTee(tee)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setDeletingTee(tee)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {/* Conditionally rendered, not just open={createOpen} on an
          always-mounted Modal (review finding, PR #136) -- Modal never
          unmounts its children when closed, so TeeConfigurationForm's
          own useForm state (whatever was typed, including validation
          errors) would otherwise persist across a close/reopen instead
          of resetting to fresh defaults. Same pattern already used for
          the Edit/Delete modals below. */}
      {createOpen && (
        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add tee configuration" className="sm:max-w-2xl">
          <TeeConfigurationForm
            onSubmit={async (input) => {
              await createMutation.mutateAsync(input);
            }}
            onCancel={() => setCreateOpen(false)}
            submitLabel="Add tee configuration"
          />
        </Modal>
      )}

      {editingTee && (
        <Modal open={Boolean(editingTee)} onClose={() => setEditingTee(null)} title="Edit tee configuration" className="sm:max-w-2xl">
          <TeeConfigurationForm
            initialValues={editingTee}
            onSubmit={async (input) => {
              await updateMutation.mutateAsync(input);
            }}
            onCancel={() => setEditingTee(null)}
            submitLabel="Save changes"
          />
        </Modal>
      )}

      {deletingTee && (
        <Modal
          open={Boolean(deletingTee)}
          onClose={() => setDeletingTee(null)}
          title="Delete tee configuration"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeletingTee(null)}>
                Cancel
              </Button>
              <Button variant="destructive" isLoading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                Delete tee configuration
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            Delete <strong>{deletingTee.name}</strong>? This is a destructive action -- it can't be undone. Rounds
            already recorded against it will block the deletion.
          </p>
        </Modal>
      )}
    </Card>
  );
}

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const courseQuery = useQuery({ queryKey: ["courses", id], queryFn: () => getCourse(id!), enabled: Boolean(id) });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/courses")}>
          ← Back
        </Button>
        <h1 className="mt-4 text-2xl font-semibold text-text">{courseQuery.data?.name ?? "Course"}</h1>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-text">Course details</h2>
        </CardHeader>
        <CardBody>
          {courseQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton variant="text" width={220} height={20} />
              <Skeleton variant="text" width={160} height={20} />
            </div>
          ) : courseQuery.isError ? (
            <Alert variant="error">
              {courseQuery.error instanceof ApiError && courseQuery.error.status === 404
                ? "This course doesn't exist, or has been deleted."
                : describeError(courseQuery.error, "Couldn't load this course. Try refreshing the page.")}
            </Alert>
          ) : isAdmin ? (
            <CourseEditForm course={courseQuery.data} />
          ) : (
            <CourseReadOnlyView course={courseQuery.data} />
          )}
        </CardBody>
      </Card>

      {courseQuery.data && <TeeConfigurationsSection course={courseQuery.data} isAdmin={isAdmin} />}
    </div>
  );
}
