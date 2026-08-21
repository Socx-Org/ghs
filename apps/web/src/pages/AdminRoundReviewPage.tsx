import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Modal,
  RoundStatusBadge,
  Skeleton,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
  useToast,
} from "../components";
import { ApiError, approveRound, getPlayer, getRound, getTeeConfiguration, rejectRound } from "../lib/api";
import type { FairwayResult, HoleScore } from "../types/domain";

// ghs#67: the admin's round-review screen -- reached from the pending
// queue, but not itself queue-scoped (it re-fetches everything for
// real, so it stays correct even if deep-linked directly rather than
// clicked through from the queue). Approve/reject both call the real
// PATCH /rounds/:id/status transition endpoints (ghs#9/#23/#24) -- no
// client-side status simulation. Reject requires a real, non-empty
// reason via a styled Modal, never window.confirm().

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function fairwayLabel(result: FairwayResult | null): string {
  if (result === "hit") return "Hit";
  if (result === "missed_left") return "Missed L";
  if (result === "missed_right") return "Missed R";
  return "—";
}

function HolesTable({ holes, holeScores }: { holes: { id: string; holeNumber: number; par: number }[]; holeScores: HoleScore[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Hole</TableHeaderCell>
          <TableHeaderCell>Par</TableHeaderCell>
          <TableHeaderCell>Strokes</TableHeaderCell>
          <TableHeaderCell>Putts</TableHeaderCell>
          <TableHeaderCell>GIR</TableHeaderCell>
          <TableHeaderCell>Fairway</TableHeaderCell>
          <TableHeaderCell>Sand</TableHeaderCell>
          <TableHeaderCell>Penalties</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {holes.map((hole) => {
          const score = holeScores.find((s) => s.holeNumber === hole.holeNumber);
          return (
            <TableRow key={hole.id}>
              <TableCell className="font-medium">{hole.holeNumber}</TableCell>
              <TableCell>{hole.par}</TableCell>
              <TableCell>{score?.strokes ?? "—"}</TableCell>
              <TableCell>{score?.putts ?? "—"}</TableCell>
              <TableCell>{score ? (score.gir ? "Yes" : "No") : "—"}</TableCell>
              <TableCell>{score ? fairwayLabel(score.fairwayResult) : "—"}</TableCell>
              <TableCell>{score ? (score.inSand ? "Yes" : "No") : "—"}</TableCell>
              <TableCell>{score?.penalties ?? "—"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default function AdminRoundReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const roundQuery = useQuery({ queryKey: ["rounds", id], queryFn: () => getRound(id!), enabled: Boolean(id) });
  const playerId = roundQuery.data?.playerId;
  const teeConfigurationId = roundQuery.data?.teeConfigurationId;
  const playerQuery = useQuery({ queryKey: ["players", playerId], queryFn: () => getPlayer(playerId!), enabled: Boolean(playerId) });
  const teeQuery = useQuery({
    queryKey: ["tee-configurations", teeConfigurationId],
    queryFn: () => getTeeConfiguration(teeConfigurationId!),
    enabled: Boolean(teeConfigurationId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["rounds", id] });
    queryClient.invalidateQueries({ queryKey: ["admin", "rounds", "pending"] });
  }

  const approveMutation = useMutation({
    mutationFn: () => approveRound(id!),
    onSuccess: () => {
      invalidate();
      show({ variant: "success", message: "Round approved.", duration: 2500 });
      navigate("/admin/rounds/pending");
    },
    onError: (error) => {
      show({ variant: "error", message: describeError(error, "Couldn't approve this round. Try again.") });
    },
  });

  function closeRejectModal() {
    setRejectOpen(false);
    // Reset the typed reason on close (Cancel/Escape/backdrop), not
    // just on a successful submit -- otherwise reopening this same
    // Modal later would show whatever was typed last time, the same
    // stale-state class of bug caught in #112's own review (PR #136).
    setRejectionReason("");
  }

  const rejectMutation = useMutation({
    mutationFn: () => rejectRound(id!, rejectionReason.trim()),
    onSuccess: () => {
      invalidate();
      closeRejectModal();
      show({ variant: "success", message: "Round rejected.", duration: 2500 });
      navigate("/admin/rounds/pending");
    },
    onError: (error) => {
      // Deliberately doesn't close the modal here -- same convention as
      // course/tee-configuration delete (#111/#112): the admin can see
      // the toast and retry from the still-open confirmation.
      show({ variant: "error", message: describeError(error, "Couldn't reject this round. Try again.") });
    },
  });

  const round = roundQuery.data;
  const teeConfiguration = teeQuery.data;
  const isPending = round?.status === "pending";
  const runningGross = round?.holeScores.reduce((sum, hole) => sum + hole.strokes, 0) ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/rounds/pending")}>
          ← Back
        </Button>
        <h1 className="mt-4 text-2xl font-semibold text-text">Review round</h1>
      </div>

      {roundQuery.isPending || (playerId && playerQuery.isPending) || (teeConfigurationId && teeQuery.isPending) ? (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <Skeleton height={40} />
            <Skeleton height={200} />
          </CardBody>
        </Card>
      ) : roundQuery.isError ? (
        <Alert variant="error">{describeError(roundQuery.error, "Couldn't load this round. Try refreshing the page.")}</Alert>
      ) : teeQuery.isError ? (
        <Alert variant="error">{describeError(teeQuery.error, "Couldn't load this round's tee configuration. Try refreshing the page.")}</Alert>
      ) : !round || !teeConfiguration ? null : (
        <>
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-text">
                {playerQuery.isError
                  ? "Couldn't load player name"
                  : playerQuery.data
                    ? `${playerQuery.data.firstName} ${playerQuery.data.lastName}`
                    : "Player"}
              </h2>
              <RoundStatusBadge status={round.status} />
            </CardHeader>
            <CardBody className="flex flex-wrap gap-8">
              <Stat label="Tee configuration" value={teeConfiguration.name} />
              <Stat label="Played" value={formatPlayedAt(round.playedAt)} />
              <Stat label="Gross so far" value={runningGross} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-text">Hole scores</h2>
            </CardHeader>
            <CardBody>
              <HolesTable holes={teeConfiguration.holes} holeScores={round.holeScores} />
            </CardBody>
          </Card>

          {isPending ? (
            <Card>
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
                <Button isLoading={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
                  Approve
                </Button>
              </CardBody>
            </Card>
          ) : (
            <Alert variant="info">This round is no longer pending -- its status may have changed since the queue was last loaded.</Alert>
          )}
        </>
      )}

      {round && (
        <Modal
          open={rejectOpen}
          onClose={closeRejectModal}
          title="Reject round"
          footer={
            <>
              <Button variant="secondary" onClick={closeRejectModal}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                isLoading={rejectMutation.isPending}
                disabled={rejectionReason.trim().length === 0}
                onClick={() => rejectMutation.mutate()}
              >
                Reject round
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-2 text-sm text-text">
            Reason
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Explain what needs correcting…"
            />
          </label>
        </Modal>
      )}
    </div>
  );
}
