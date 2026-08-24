import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, CardBody, CardHeader, HoleEntryCard, RoundHoleCsvImportForm, RoundStatusBadge, Skeleton, Stat, ToggleGroup, useToast } from "../components";
import { ApiError, getRound, getTeeConfiguration, submitRound } from "../lib/api";
import { EDITABLE_ROUND_STATUSES } from "../types/domain";
import type { Round, TeeConfiguration } from "../types/domain";

// ghs#94: the hole-by-hole entry (and resume-in-progress) screen.
// Editable statuses only (draft/rejected/amending) -- viewing a
// submitted round's result is a later epic item, not this one.
//
// ghs#68: edit/resubmit for a rejected/amending round already worked
// via EDITABLE_ROUND_STATUSES below -- the real gap this issue closes
// is that a rejected round's rejectionReason was never actually shown
// to the player anywhere (confirmed by direct code inspection: it went
// straight into the same generic entry form a draft round does, with
// no visible indication it had been rejected at all, let alone why).
// 'amending' has no equivalent reason to show -- confirmed directly in
// rounds.service.ts's reopenForAmendment, whose own reason parameter is
// only ever logged, never persisted on the round row itself.

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function AlreadySubmitted({ round, onBack }: { round: Round; onBack: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <RoundStatusBadge status={round.status} />
        <p className="text-sm text-text-muted">
          This round was played on {formatPlayedAt(round.playedAt)} and has already been submitted -- it can no longer be edited here.
        </p>
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back to dashboard
        </Button>
      </CardBody>
    </Card>
  );
}

function HoleEntryForm({
  round,
  teeConfiguration,
  onSubmit,
  isSubmitting,
  submitFeedback,
}: {
  round: Round;
  teeConfiguration: TeeConfiguration;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitFeedback: string | null;
}) {
  const requiredCount = round.is9Hole ? 9 : teeConfiguration.holes.length;
  const recordedCount = round.holeScores.length;
  const runningGross = round.holeScores.reduce((sum, hole) => sum + hole.strokes, 0);
  const canSubmit = recordedCount >= requiredCount;
  // ghs#160: available whenever manual entry is, not gated on zero holes
  // recorded yet -- a CSV can bulk-fill some holes and leave the rest for
  // manual entry, or re-import a corrected file, exactly like re-editing
  // a single already-saved HoleEntryCard already works.
  const [mode, setMode] = useState<"manual" | "csv">("manual");

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-text">{teeConfiguration.name}</h1>
            <p className="text-sm text-text-muted">{formatPlayedAt(round.playedAt)}</p>
          </div>
          <RoundStatusBadge status={round.status} />
        </CardHeader>
        <CardBody className="flex gap-8">
          <Stat label="Holes recorded" value={`${recordedCount} / ${requiredCount}`} />
          <Stat label="Gross so far" value={runningGross} />
        </CardBody>
      </Card>

      {round.status === "rejected" && round.rejectionReason && (
        <Alert variant="error" title="This round was rejected">
          {round.rejectionReason}
        </Alert>
      )}

      <fieldset className="flex items-center gap-2 border-0 p-0">
        <legend className="text-sm text-text-muted">How do you want to enter hole scores?</legend>
        <ToggleGroup
          name="round-entry-mode"
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

      {mode === "manual" ? (
        <div className="flex flex-col gap-3">
          {teeConfiguration.holes.map((hole) => (
            <HoleEntryCard
              key={hole.id}
              roundId={round.id}
              holeNumber={hole.holeNumber}
              par={hole.par}
              strokeIndex={hole.strokeIndex}
              existingScore={round.holeScores.find((score) => score.holeNumber === hole.holeNumber)}
              disabled={false}
            />
          ))}
        </div>
      ) : (
        <RoundHoleCsvImportForm roundId={round.id} holeCount={teeConfiguration.holes.length} />
      )}

      <Card>
        <CardBody className="flex flex-col gap-3">
          {submitFeedback && <Alert variant="error">{submitFeedback}</Alert>}
          {!canSubmit && (
            <p className="text-sm text-text-muted">
              Record {requiredCount - recordedCount} more hole{requiredCount - recordedCount === 1 ? "" : "s"} before submitting.
            </p>
          )}
          <Button onClick={onSubmit} isLoading={isSubmitting} disabled={!canSubmit} className="w-full">
            Submit for review
          </Button>
        </CardBody>
      </Card>
    </>
  );
}

export default function RoundEntryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [submitFeedback, setSubmitFeedback] = useState<string | null>(null);

  const roundQuery = useQuery({ queryKey: ["rounds", id], queryFn: () => getRound(id!), enabled: Boolean(id) });
  const teeConfigurationId = roundQuery.data?.teeConfigurationId;
  const teeQuery = useQuery({
    queryKey: ["tee-configurations", teeConfigurationId],
    queryFn: () => getTeeConfiguration(teeConfigurationId!),
    enabled: Boolean(teeConfigurationId),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitRound(id!),
    onSuccess: (submittedRound) => {
      queryClient.invalidateQueries({ queryKey: ["rounds", id] });
      queryClient.invalidateQueries({ queryKey: ["players"] });
      // ghs#114: an admin-created round auto-approves on submit (#100)
      // instead of entering the pending queue -- the confirmation
      // message reflects whichever real outcome the backend's response
      // actually reports, not an assumption based on who's viewing this
      // screen (an admin could in principle submit their own player
      // round too, which still goes to pending like any other).
      show({
        variant: "success",
        message: submittedRound.status === "approved" ? "Round approved automatically." : "Submitted for review.",
        duration: 2500,
      });
      navigate("/", { replace: true });
    },
  });

  async function handleSubmit() {
    setSubmitFeedback(null);
    try {
      await submitMutation.mutateAsync();
    } catch (error) {
      setSubmitFeedback(error instanceof ApiError ? error.message : "Couldn't submit this round. Try again.");
    }
  }

  const round = roundQuery.data;
  const teeConfiguration = teeQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="self-start">
        ← Back
      </Button>

      {roundQuery.isPending || teeQuery.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton height={80} />
          <Skeleton height={200} />
        </div>
      ) : roundQuery.isError ? (
        <Alert variant="error">
          {roundQuery.error instanceof ApiError ? roundQuery.error.message : "Couldn't load this round. Try refreshing the page."}
        </Alert>
      ) : teeQuery.isError ? (
        <Alert variant="error">
          {teeQuery.error instanceof ApiError ? teeQuery.error.message : "Couldn't load this round's tee configuration. Try refreshing the page."}
        </Alert>
      ) : !round || !teeConfiguration ? (
        // Unreachable in practice -- isPending/isError above already
        // cover every real state -- but TS can't correlate a query's
        // isPending/isError with a separately-destructured `data`
        // binding, so this guard is what actually narrows `round`/
        // `teeConfiguration` to defined below (caught by `tsc -b`,
        // stricter than this app's --noEmit typecheck).
        null
      ) : !EDITABLE_ROUND_STATUSES.has(round.status) ? (
        <AlreadySubmitted round={round} onBack={() => navigate("/")} />
      ) : (
        <HoleEntryForm
          round={round}
          teeConfiguration={teeConfiguration}
          onSubmit={handleSubmit}
          isSubmitting={submitMutation.isPending}
          submitFeedback={submitFeedback}
        />
      )}
    </div>
  );
}
