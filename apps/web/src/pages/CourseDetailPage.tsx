import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Card, CardBody, CardHeader, FormField, Input, Modal, Skeleton, useToast } from "../components";
import { ApiError, deleteCourse, getCourse, updateCourse } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type { Course } from "../types/domain";

// ghs#110: course detail/edit screen -- design doc section 6.4. Also
// the "course detail view" #112 (Tee Configuration management) builds
// its own list/create/update/delete actions into -- the Tee
// Configurations section below is deliberately read-only for now (name/
// hole count/ratings only, no per-hole breakdown), not this issue's own
// scope to make interactive.
//
// Reachable by every authenticated role (matches GET /courses/:id
// having no role restriction, same reasoning as #109's course list) --
// only the edit form/delete action are admin-gated; a non-admin sees
// the same read-only info a course list entry already implied existed.
//
// ghs#111: delete lives here, not on the course list (#109) -- #109's
// own scope explicitly excludes an actions column, and this detail page
// is already the one real place per-course admin actions live (the
// edit form above it). Real Modal confirmation, same pattern as account
// deletion (#104) -- not window.confirm(). No cascading "delete
// referencing rounds too" option (explicit non-scope) -- a 409
// course_has_rounds response is mapped to a clean explanation, not a
// raw error.

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

// ghs#111/#99. "course_has_rounds" is the backend's own stable code,
// not human copy (same convention as auth's token-classification
// errors) -- mapped to a real explanation here, not shown verbatim.
function describeDeleteError(error: unknown): string {
  if (error instanceof ApiError && error.message === "course_has_rounds") {
    return "This course can't be deleted because it has rounds recorded against it.";
  }
  return describeError(error, "Couldn't delete the course. Try again.");
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

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const courseQuery = useQuery({ queryKey: ["courses", id], queryFn: () => getCourse(id!), enabled: Boolean(id) });
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteCourse(id!),
    onSuccess: () => {
      setDeleteModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      show({ variant: "success", message: "Course deleted.", duration: 2500 });
      navigate("/courses");
    },
    onError: (error) => {
      // Deliberately doesn't close the modal here (only onSuccess does)
      // -- same convention as account deletion (#104): the admin can
      // see the toast and decide to cancel or retry from the
      // still-open confirmation, rather than being bounced out of it.
      show({ variant: "error", message: describeDeleteError(error) });
    },
  });

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

      {courseQuery.data && isAdmin && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-text">Danger zone</h2>
          </CardHeader>
          <CardBody className="flex items-center justify-between gap-3">
            <p className="text-sm text-text-muted">Deleting a course cannot be undone from here.</p>
            <Button variant="destructive" onClick={() => setDeleteModalOpen(true)}>
              Delete course
            </Button>
          </CardBody>
        </Card>
      )}

      {courseQuery.data && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-text">Tee configurations</h2>
          </CardHeader>
          <CardBody>
            {courseQuery.data.teeConfigurations.length === 0 ? (
              <p className="text-sm text-text-muted">No tee configurations yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {courseQuery.data.teeConfigurations.map((tee) => (
                  <li key={tee.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="text-sm font-medium text-text">{tee.name}</span>
                    <span className="text-xs text-text-muted">
                      {tee.holeCount} holes · rating {tee.courseRating.toFixed(1)} · slope {tee.slopeRating}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {courseQuery.data && (
        <Modal
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          title="Delete course"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" isLoading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                Delete course
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            Delete <strong>{courseQuery.data.name}</strong>? This is a destructive action -- it can't be undone. Rounds
            already recorded against this course's tee configurations will block the deletion.
          </p>
        </Modal>
      )}
    </div>
  );
}
