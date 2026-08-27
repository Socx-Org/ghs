import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Alert, BackButton, Button, Checkbox, FormField, Input, Select } from "../components";
import { ApiError, createRound, getCourse, getMyPlayerProfile, listCourses, listUsers } from "../lib/api";
import { playedAtToIsoString, today } from "../lib/dates";
import { useAuth } from "../hooks/useAuth";

// ghs#94: the start of the round-entry flow -- course, then tee
// configuration (its own query, only once a course is chosen, since
// GET /courses only returns a flat list -- tee configurations are
// nested under GET /courses/:id, ghs#57's own data shape), then the
// date played. Creates the round in 'draft' and hands off to
// RoundEntryPage for the actual scoring.
//
// ghs#114: an admin/super_admin caller additionally gets a player-
// selection step -- POST /rounds already accepts an arbitrary playerId
// from an admin caller (ghs#9), only the frontend never offered a way
// to choose one. playerId is validated at submit time (mirroring this
// file's own existing profile-not-loaded-yet check below), not via the
// zod schema -- whether it's required depends on the caller's role,
// which isn't known at schema-definition time.

const schema = z.object({
  playerId: z.string().optional(),
  courseId: z.string().min(1, "Choose a course"),
  teeConfigurationId: z.string().min(1, "Choose a tee"),
  playedAt: z.string().min(1, "Choose a date"),
  isTournament: z.boolean(),
  is9Hole: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export default function NewRoundPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [feedback, setFeedback] = useState<string | null>(null);

  // Only a player caller has a players/me profile at all (IAM-020's
  // strict users/players separation) -- gated off for admin/super_admin
  // to avoid an always-404 request neither of them can ever satisfy.
  const profileQuery = useQuery({ queryKey: ["players", "me"], queryFn: getMyPlayerProfile, enabled: !isAdmin });
  // ghs#114: the player-selector's own data source -- GET /admin/users
  // filtered to role=player, gated to admin/super_admin only.
  const playersQuery = useQuery({ queryKey: ["admin", "users", { role: "player" }], queryFn: () => listUsers({ role: "player" }), enabled: isAdmin });
  const coursesQuery = useQuery({ queryKey: ["courses"], queryFn: listCourses });

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { playerId: "", courseId: "", teeConfigurationId: "", playedAt: today(), isTournament: false, is9Hole: false },
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
      // The round's own playerId, not profileQuery.data?.id -- always
      // defined by the time a round actually exists, and doesn't depend
      // on profileQuery's state still being what it was when the
      // mutation was kicked off (review finding, PR #95).
      queryClient.invalidateQueries({ queryKey: ["players", round.playerId, "rounds"] });
      navigate(`/rounds/${round.id}`, { replace: true });
    },
  });

  async function onSubmit(values: FormValues) {
    setFeedback(null);
    // ghs#114: an admin/super_admin caller supplies playerId from the
    // selector below; a player caller always acts on their own profile,
    // same as before this issue. Validated here, not via the zod schema
    // (whether playerId is required depends on isAdmin, not known at
    // schema-definition time) -- same "real feedback, not a silent
    // no-op" discipline as the profile-not-loaded check this mirrors
    // (review finding, PR #95).
    let playerId: string;
    if (isAdmin) {
      if (!values.playerId) {
        setFeedback("Choose a player.");
        return;
      }
      playerId = values.playerId;
    } else {
      if (!profileQuery.data) {
        setFeedback(
          profileQuery.error instanceof ApiError
            ? profileQuery.error.message
            : "Still loading your profile -- try again in a moment.",
        );
        return;
      }
      playerId = profileQuery.data.id;
    }
    try {
      await createRoundMutation.mutateAsync({
        playerId,
        teeConfigurationId: values.teeConfigurationId,
        playedAt: playedAtToIsoString(values.playedAt),
        isTournament: values.isTournament,
        is9Hole: values.is9Hole,
      });
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12">
      <BackButton onClick={() => navigate("/")} />
      <h1 className="mt-4 text-2xl font-semibold text-text">Start a round</h1>
      <p className="mt-2 text-sm text-text-muted">
        {isAdmin
          ? "Choose the player, course, and tee, then enter their scores hole by hole."
          : "Choose the course and tee you're playing, then enter your scores hole by hole."}
      </p>

      <form className="mt-8 flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
        {feedback && <Alert variant="error">{feedback}</Alert>}

        {isAdmin && (
          <FormField label="Player">
            <Select {...register("playerId")} disabled={playersQuery.isPending}>
              <option value="">{playersQuery.isPending ? "Loading players…" : "Select a player"}</option>
              {playersQuery.data?.items
                .filter((item) => item.playerId !== null)
                .map((item) => (
                  <option key={item.playerId} value={item.playerId!}>
                    {item.firstName} {item.lastName}
                  </option>
                ))}
            </Select>
          </FormField>
        )}

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
  );
}
