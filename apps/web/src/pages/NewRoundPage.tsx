import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Checkbox, FormField, Input, Select } from "../components";
import { ApiError, createRound, getCourse, getMyPlayerProfile, listCourses } from "../lib/api";

// ghs#94: the start of the round-entry flow -- course, then tee
// configuration (its own query, only once a course is chosen, since
// GET /courses only returns a flat list -- tee configurations are
// nested under GET /courses/:id, ghs#57's own data shape), then the
// date played. Creates the round in 'draft' and hands off to
// RoundEntryPage for the actual scoring.

const schema = z.object({
  courseId: z.string().min(1, "Choose a course"),
  teeConfigurationId: z.string().min(1, "Choose a tee"),
  playedAt: z.string().min(1, "Choose a date"),
  isTournament: z.boolean(),
  is9Hole: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewRoundPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);

  const profileQuery = useQuery({ queryKey: ["players", "me"], queryFn: getMyPlayerProfile });
  const coursesQuery = useQuery({ queryKey: ["courses"], queryFn: listCourses });

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { courseId: "", teeConfigurationId: "", playedAt: today(), isTournament: false, is9Hole: false },
  });

  const courseId = useWatch({ control, name: "courseId" });
  const courseQuery = useQuery({ queryKey: ["courses", courseId], queryFn: () => getCourse(courseId), enabled: courseId.length > 0 });

  // The tee list changes whenever the chosen course changes -- a
  // previously-selected tee id from a different course must not linger
  // as a stale, invisible selection.
  useEffect(() => {
    setValue("teeConfigurationId", "");
  }, [courseId, setValue]);

  const createRoundMutation = useMutation({
    mutationFn: createRound,
    onSuccess: (round) => {
      queryClient.invalidateQueries({ queryKey: ["players", profileQuery.data?.id, "rounds"] });
      navigate(`/rounds/${round.id}`, { replace: true });
    },
  });

  async function onSubmit(values: FormValues) {
    setFeedback(null);
    if (!profileQuery.data) return;
    try {
      await createRoundMutation.mutateAsync({
        playerId: profileQuery.data.id,
        teeConfigurationId: values.teeConfigurationId,
        playedAt: new Date(values.playedAt).toISOString(),
        isTournament: values.isTournament,
        is9Hole: values.is9Hole,
      });
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-bg-page px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          ← Back
        </Button>
        <h1 className="mt-4 text-2xl font-semibold text-text">Start a round</h1>
        <p className="mt-2 text-sm text-text-muted">Choose the course and tee you're playing, then enter your scores hole by hole.</p>

        <form className="mt-8 flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
          {feedback && <Alert variant="error">{feedback}</Alert>}

          <FormField label="Course" error={errors.courseId?.message}>
            <Select {...register("courseId")} disabled={coursesQuery.isPending}>
              <option value="">{coursesQuery.isPending ? "Loading courses…" : "Select a course"}</option>
              {coursesQuery.data?.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Tee" error={errors.teeConfigurationId?.message}>
            <Select {...register("teeConfigurationId")} disabled={!courseId || courseQuery.isPending}>
              <option value="">{!courseId ? "Choose a course first" : courseQuery.isPending ? "Loading tees…" : "Select a tee"}</option>
              {courseQuery.data?.teeConfigurations.map((tee) => (
                <option key={tee.id} value={tee.id}>
                  {tee.name} ({tee.holeCount} holes)
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Date played" error={errors.playedAt?.message}>
            <Input type="date" {...register("playedAt")} />
          </FormField>

          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox {...register("isTournament")} />
            Tournament round
          </label>

          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox {...register("is9Hole")} />
            9-hole round
          </label>

          <Button type="submit" isLoading={isSubmitting} className="w-full">
            Start round
          </Button>
        </form>
      </div>
    </div>
  );
}
