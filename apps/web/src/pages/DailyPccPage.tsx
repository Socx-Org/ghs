import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, FormField, Input, Select, Skeleton, Stat, RoundStatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, useToast } from "../components";
import { ApiError, getCourse, getDailyPcc, listAdminRounds, listCourses, setDailyPcc } from "../lib/api";
import type { PccCorrectionOutcome } from "../types/domain";

// ghs#168: the Daily PCC screen -- the admin-facing half of "move
// scoring to submission time" (rounds.service.ts's own submitForReview
// change). Scoped to one tee-configuration/day pair at a time, matching
// the real WHS concept PCC applies to and the schema's own
// UNIQUE(tee_configuration_id, played_on) key (006_pcc.sql) -- already
// scales to multiple clubs/courses/tournaments sharing a tee on the same
// day with no changes needed here, since each is just a different
// tee-configuration id.

const PCC_OVERRIDE_OPTIONS = [-1, 0, 1, 2, 3];

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatScore(value: number | null): string {
  return value === null ? "—" : String(value);
}

function formatDifferential(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function summarize(result: PccCorrectionOutcome): string {
  const roundsLabel = result.updatedRounds === 1 ? "1 round" : `${result.updatedRounds} rounds`;
  const eligible = result.playerRecalculations.filter((r) => r.status === "eligible").length;
  const playersLabel = result.playerRecalculations.length === 1 ? "1 player" : `${result.playerRecalculations.length} players`;
  return `PCC set to ${result.dailyPcc.pcc} (${result.dailyPcc.source}). ${roundsLabel} updated, ${playersLabel} recalculated${eligible > 0 ? ` (${eligible} with a new handicap index)` : ""}.`;
}

export default function DailyPccPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [courseId, setCourseId] = useState("");
  const [teeConfigurationId, setTeeConfigurationId] = useState("");
  const [playedOn, setPlayedOn] = useState(today());
  const [overrideValue, setOverrideValue] = useState("");

  const coursesQuery = useQuery({ queryKey: ["courses"], queryFn: listCourses });
  const courseQuery = useQuery({ queryKey: ["courses", courseId], queryFn: () => getCourse(courseId), enabled: courseId.length > 0 });

  const scoped = teeConfigurationId.length > 0 && playedOn.length > 0;

  const dailyPccQuery = useQuery({
    queryKey: ["admin", "pcc", teeConfigurationId, playedOn],
    queryFn: () => getDailyPcc(teeConfigurationId, playedOn),
    enabled: scoped,
  });
  const roundsQuery = useQuery({
    queryKey: ["admin", "rounds", { teeConfigurationId, playedOn }],
    queryFn: () => listAdminRounds({ teeConfigurationId, playedOn }),
    enabled: scoped,
  });

  const applyMutation = useMutation({
    mutationFn: (pccOverride: number | null) => setDailyPcc(teeConfigurationId, playedOn, pccOverride),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "pcc", teeConfigurationId, playedOn] });
      queryClient.invalidateQueries({ queryKey: ["admin", "rounds"] });
      setOverrideValue("");
      show({ variant: "success", message: summarize(result), duration: 5000 });
    },
    onError: (error) => {
      show({ variant: "error", message: describeQueryError(error, "Couldn't update PCC for this tee/day. Try again.") });
    },
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div>
        <h1 className="mt-4 text-2xl font-semibold text-text">Daily PCC</h1>
        <p className="mt-2 text-sm text-text-muted">
          Review a tee configuration's submitted rounds for a single day, then accept the calculated Playing Conditions
          Calculation or override it.
        </p>
      </div>

      <Card className="mt-8">
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <FormField label="Course" className="flex-1">
            <Select
              value={courseId}
              onChange={(e) => {
                // A previously-selected tee id from a different course
                // must not linger as a stale, invisible selection -- same
                // reasoning as NewRoundPage's own course/tee cascade,
                // done directly in the handler rather than an effect (no
                // setState-in-effect).
                setCourseId(e.target.value);
                setTeeConfigurationId("");
              }}
              disabled={coursesQuery.isPending}
            >
              <option value="">{coursesQuery.isPending ? "Loading courses…" : "Select a course"}</option>
              {coursesQuery.data?.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Tee" className="flex-1">
            <Select
              value={teeConfigurationId}
              onChange={(e) => setTeeConfigurationId(e.target.value)}
              disabled={!courseId || courseQuery.isPending}
            >
              <option value="">{!courseId ? "Choose a course first" : courseQuery.isPending ? "Loading tees…" : "Select a tee"}</option>
              {courseQuery.data?.teeConfigurations.map((tee) => (
                <option key={tee.id} value={tee.id}>
                  {tee.name} ({tee.holeCount} holes)
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Date played" className="flex-1">
            <Input type="date" value={playedOn} onChange={(e) => setPlayedOn(e.target.value)} />
          </FormField>
        </CardBody>
      </Card>

      {!scoped ? null : (
        <>
          <Card className="mt-6">
            <CardHeader>
              <h2 className="text-base font-semibold text-text">Playing Conditions Calculation</h2>
            </CardHeader>
            <CardBody>
              {dailyPccQuery.isPending ? (
                <Skeleton height={40} />
              ) : dailyPccQuery.isError ? (
                <Alert variant="error">{describeQueryError(dailyPccQuery.error, "Couldn't load today's PCC. Try refreshing the page.")}</Alert>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-end gap-6">
                    <Stat label="Current PCC" value={dailyPccQuery.data.pcc} />
                    <Badge variant={dailyPccQuery.data.source === "override" ? "warning" : "neutral"}>
                      {dailyPccQuery.data.source === "override" ? "Manually overridden" : "Calculated from rounds"}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <Button
                      variant="secondary"
                      isLoading={applyMutation.isPending && applyMutation.variables === null}
                      onClick={() => applyMutation.mutate(null)}
                    >
                      Recalculate from rounds
                    </Button>

                    <FormField label="Override PCC">
                      <Select value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)}>
                        <option value="">Choose a value</option>
                        {PCC_OVERRIDE_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value > 0 ? `+${value}` : value}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <Button
                      isLoading={applyMutation.isPending && applyMutation.variables !== null}
                      disabled={overrideValue === ""}
                      onClick={() => applyMutation.mutate(Number(overrideValue))}
                    >
                      Apply override
                    </Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <h2 className="text-base font-semibold text-text">Rounds this day</h2>
            </CardHeader>
            <CardBody>
              {roundsQuery.isPending ? (
                <div className="flex flex-col gap-2">
                  <Skeleton height={40} />
                  <Skeleton height={40} />
                </div>
              ) : roundsQuery.isError ? (
                <Alert variant="error">{describeQueryError(roundsQuery.error, "Couldn't load this day's rounds. Try refreshing the page.")}</Alert>
              ) : roundsQuery.data.items.length === 0 ? (
                <EmptyState title="No rounds yet" description="No rounds have been created for this tee configuration on this day." />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Player</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Gross</TableHeaderCell>
                      <TableHeaderCell>Adjusted gross</TableHeaderCell>
                      <TableHeaderCell>Differential</TableHeaderCell>
                      <TableHeaderCell>PCC</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {roundsQuery.data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          {item.playerFirstName} {item.playerLastName}
                        </TableCell>
                        <TableCell>
                          <RoundStatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>{formatScore(item.grossScore)}</TableCell>
                        <TableCell>{formatScore(item.adjustedGrossScore)}</TableCell>
                        <TableCell>{formatDifferential(item.scoreDifferential)}</TableCell>
                        <TableCell>{formatScore(item.pcc)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-3 text-xs text-text-muted">
                Rounds without a recorded score yet (still in draft) are excluded from the calculation above -- {formatPlayedAt(`${playedOn}T00:00:00.000Z`)}.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
