import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, CardBody, EmptyState, ListView, Modal, RoundStatusBadge, Skeleton, TableCell, TableHeaderCell, useToast } from "../components";
import { ApiError, deleteRound, getMyPlayerProfile, getPlayerRounds } from "../lib/api";
import { ROUND_STATUS_OPTIONS } from "../lib/domain-labels";
import { EDITABLE_ROUND_STATUSES } from "../types/domain";
import type { PlayerRoundListItem } from "../types/domain";

// ghs#147: the player's own "My Rounds" screen -- a real, browsable
// list of every round they've played, distinct from PlayerDashboardPage's
// narrow "Recent rounds" widget (unchanged, kept as the dashboard's
// quick-glance summary, per this issue's own explicit non-scope) and
// from #113's admin all-rounds list (this one is scoped to the caller's
// own rounds, via GET /players/:playerId/rounds, ownership-checked
// server-side, not just hidden client-side).
//
// View/Create/Edit/Delete:
// - View: each row's course name links to RoundDetailsPage
//   (/rounds/:id/details, new) -- works for any status.
// - Create: unchanged, reuses NewRoundPage (linked from the header).
// - Edit: unchanged, reuses RoundEntryPage's existing edit flow
//   (/rounds/:id) -- offered only while the round is still editable
//   (EDITABLE_ROUND_STATUSES), matching PlayerDashboardPage's own
//   Continue-button gating.
// - Delete: real confirmation Modal, offered only while editable too --
//   rounds.service.ts's own deleteRound rejects a player attempting to
//   delete an already-pending/approved round with 409 (platform-owner
//   decision, ghs#147: only admin may remove those, matching #115's own
//   unrestricted delete). Matching, not merely tolerating, that server
//   rule by not offering the action at all once it would just be
//   rejected.

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function MyRoundsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<PlayerRoundListItem | null>(null);

  const profileQuery = useQuery({ queryKey: ["players", "me"], queryFn: getMyPlayerProfile });
  const playerId = profileQuery.data?.id;
  const roundsQuery = useQuery({
    queryKey: ["players", playerId, "rounds"],
    queryFn: () => getPlayerRounds(playerId!),
    enabled: Boolean(playerId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRound(id),
    onSuccess: (_result, id) => {
      // Same reasoning as AdminRoundsListPage/AdminRoundReviewPage's own
      // delete handling (review finding, PR #145) -- remove the deleted
      // round's own cached query outright rather than leaving it to go
      // stale, and refresh both this list and the dashboard widget that
      // reads the same underlying endpoint.
      queryClient.removeQueries({ queryKey: ["rounds", id] });
      queryClient.invalidateQueries({ queryKey: ["players", playerId, "rounds"] });
      setDeleteTarget(null);
      // A player may only delete an editable-status round (the only
      // kind this button is ever offered for), and an editable round
      // never had a real scoreDifferential yet (that's only computed on
      // admin approval) -- so unlike #115's admin delete, this never has
      // a recalculation outcome to report honestly here.
      show({ variant: "success", message: "Round deleted.", duration: 2500 });
    },
    onError: (error) => {
      show({ variant: "error", message: describeQueryError(error, "Couldn't delete this round. Try again.") });
    },
  });

  function renderActions(item: PlayerRoundListItem) {
    if (!EDITABLE_ROUND_STATUSES.has(item.status)) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} onClick={() => navigate(`/rounds/${item.id}`)}>
          Edit
        </Button>
        <Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} onClick={() => setDeleteTarget(item)}>
          Delete
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="mt-4 text-2xl font-semibold text-text">My Rounds</h1>
          <p className="mt-2 text-sm text-text-muted">Every round you've played.</p>
        </div>
        <Button onClick={() => navigate("/rounds/new")}>New round</Button>
      </div>

      <Card className="mt-8">
        <CardBody>
          {profileQuery.isError ? (
            <Alert variant="error">{describeQueryError(profileQuery.error, "Couldn't load your profile. Try refreshing the page.")}</Alert>
          ) : profileQuery.isPending || roundsQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          ) : roundsQuery.isError ? (
            <Alert variant="error">{describeQueryError(roundsQuery.error, "Couldn't load your rounds. Try refreshing the page.")}</Alert>
          ) : (
            <ListView<PlayerRoundListItem>
              id="my-rounds"
              items={roundsQuery.data}
              getKey={(item) => item.id}
              searchPlaceholder="Search by course or tee…"
              getSearchText={(item) => `${item.courseName} ${item.teeConfigurationName}`}
              filters={[{ id: "status", label: "Status", getValue: (item) => item.status, options: ROUND_STATUS_OPTIONS }]}
              tableHead={
                <>
                  <TableHeaderCell>Course</TableHeaderCell>
                  <TableHeaderCell>Tee</TableHeaderCell>
                  <TableHeaderCell>Played</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </>
              }
              renderTableRow={(item) => (
                <>
                  <TableCell>
                    <Link to={`/rounds/${item.id}/details`} className="font-medium text-primary hover:underline">
                      {item.courseName}
                    </Link>
                  </TableCell>
                  <TableCell>{item.teeConfigurationName}</TableCell>
                  <TableCell>{formatPlayedAt(item.playedAt)}</TableCell>
                  <TableCell>
                    <RoundStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>{renderActions(item)}</TableCell>
                </>
              )}
              renderCard={(item) => (
                <Card>
                  <CardBody className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/rounds/${item.id}/details`} className="text-sm font-medium text-primary hover:underline">
                        {item.courseName}
                      </Link>
                      <RoundStatusBadge status={item.status} />
                    </div>
                    <p className="text-xs text-text-muted">{item.teeConfigurationName}</p>
                    <p className="text-xs text-text-muted">{formatPlayedAt(item.playedAt)}</p>
                    {renderActions(item)}
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="No rounds yet" description="Rounds you play and submit will show up here." />}
            />
          )}
        </CardBody>
      </Card>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete round"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
              isLoading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete round
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Delete this round permanently? This can't be undone.
        </p>
      </Modal>
    </div>
  );
}
