import { useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, BackButton, Button, Card, CardBody, CardHeader, HolesTable, Modal, RoundStatusBadge, Skeleton, Stat, Textarea, useToast } from "../components";
import { ApiError, approveRound, deleteRound, getPlayer, getRound, getTeeConfiguration, rejectRound } from "../lib/api";

// ghs#67: the admin's round-review screen -- reached from the pending
// queue, but not itself queue-scoped (it re-fetches everything for
// real, so it stays correct even if deep-linked directly rather than
// clicked through from the queue). Approve/reject both call the real
// PATCH /rounds/:id/status transition endpoints (ghs#9/#23/#24) -- no
// client-side status simulation. Reject requires a real, non-empty
// reason via a styled Modal, never window.confirm().
//
// ghs#115: delete is a separate, always-available action -- unlike
// Approve/Reject (only meaningful while pending), rounds.service.ts's
// deleteRound allows deletion from any status, so its button isn't
// gated by isPending below.
//
// ghs#147: this screen's own hole-by-hole table was extracted into the
// shared HolesTable component once RoundDetailsPage (the player's own
// round-detail view) needed the exact same presentation -- not worth a
// third duplication.

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function AdminRoundReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

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
    // ghs#115: ["admin", "rounds"] alone (TanStack's default partial-key
    // matching) covers both #113's all-rounds list AND #67's
    // ["admin", "rounds", "pending"] queue as a prefix match -- this
    // screen is now reachable from either, so both need to stay fresh
    // regardless of which one the admin returns to, not just the
    // pending queue (the only entry point that existed when this
    // helper was first written).
    queryClient.invalidateQueries({ queryKey: ["admin", "rounds"] });
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

  const deleteMutation = useMutation({
    mutationFn: () => deleteRound(id!),
    onSuccess: (result) => {
      // Not invalidate() -- the round itself is gone (soft-deleted), so
      // refetching its own ["rounds", id] query would just 404 for no
      // reason (we're navigating away below regardless). Only the
      // admin list caches need a fresh read, so the deleted round
      // disappears from whichever one the admin returns to.
      queryClient.removeQueries({ queryKey: ["rounds", id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "rounds"] });
      setDeleteOpen(false);
      // ghs#115: clear messaging about the real outcome, not a generic
      // "deleted" regardless of whether a recalculation actually
      // happened -- matches rounds.service.ts's own real behaviour
      // (only recalculates when the round had a scoreDifferential).
      show({
        variant: "success",
        message: result.recalculated ? "Round deleted. The player's handicap has been recalculated." : "Round deleted.",
        duration: 3000,
      });
      // "/admin/rounds" (the general all-rounds list, #113), not
      // "/admin/rounds/pending" -- unlike Approve/Reject (only ever
      // reachable from the pending queue), Delete is available
      // regardless of which admin round view this screen was reached
      // from, so it shouldn't assume the pending queue is "where the
      // admin came from."
      navigate("/admin/rounds");
    },
    onError: (error) => {
      show({ variant: "error", message: describeError(error, "Couldn't delete this round. Try again.") });
    },
  });

  const round = roundQuery.data;
  const teeConfiguration = teeQuery.data;
  const isPending = round?.status === "pending";
  const runningGross = round?.holeScores.reduce((sum, hole) => sum + hole.strokes, 0) ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <BackButton onClick={() => navigate("/admin/rounds/pending")} />
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
                <Button variant="destructive" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
                <Button
                  icon={<Check aria-hidden="true" className="h-4 w-4" />}
                  isLoading={approveMutation.isPending}
                  onClick={() => approveMutation.mutate()}
                >
                  Approve
                </Button>
              </CardBody>
            </Card>
          ) : (
            <Alert variant="info">This round is no longer pending -- its status may have changed since the queue was last loaded.</Alert>
          )}

          {/* ghs#115: always available, regardless of status -- unlike
              Approve/Reject above. */}
          <Card>
            <CardBody className="flex justify-end">
              <Button variant="destructive" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}>
                Delete round
              </Button>
            </CardBody>
          </Card>
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
                icon={<X aria-hidden="true" className="h-4 w-4" />}
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

      {round && (
        <Modal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete round"
          footer={
            <>
              <Button variant="secondary" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                isLoading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                Delete round
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            Delete this round permanently? This can't be undone.{" "}
            {round.scoreDifferential !== null && "This round has a recorded score -- the player's handicap will be recalculated."}
          </p>
        </Modal>
      )}
    </div>
  );
}
