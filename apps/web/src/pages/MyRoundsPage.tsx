import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, CardBody, EmptyState, ListView, Modal, RoundStatusBadge, Skeleton, TableCell, TableHeaderCell, Tooltip, useToast } from "../components";
import { ApiError, deleteRound, getMyPlayerProfile, getPlayerRounds } from "../lib/api";
import { ROUND_STATUS_OPTIONS } from "../lib/domain-labels";
import { AMENDABLE_ROUND_STATUSES, EDITABLE_ROUND_STATUSES } from "../types/domain";
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
// - Edit: reuses RoundEntryPage's existing edit flow (/rounds/:id) --
//   offered while the round is still amendable (AMENDABLE_ROUND_STATUSES,
//   ghs#193 -- now also 'pending', matching PlayerDashboardPage's own
//   Continue-button gating).
// - Delete: real confirmation Modal, offered only while editable in the
//   NARROWER sense (EDITABLE_ROUND_STATUSES, unchanged by ghs#193 --
//   player-initiated delete of a pending round was explicit non-scope
//   there) -- rounds.service.ts's own deleteRound rejects a player
//   attempting to delete an already-pending/approved round with 409
//   (platform-owner decision, ghs#147: only admin may remove those,
//   matching #115's own unrestricted delete). Matching, not merely
//   tolerating, that server rule by not offering the action at all once
//   it would just be rejected.

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
      // A player may only delete an editable-status round (draft/
      // rejected/amending, the only kinds this button is ever offered
      // for). draft/rejected never counted toward handicap either way.
      // amending is the one exception -- it was previously approved, so
      // deleting it DOES trigger a real recalculation server-side
      // (ghs#168's everCountedTowardHandicap, rounds.service.ts, is true
      // for 'amending'). This toast deliberately stays generic
      // regardless -- unlike #115's admin delete, no UX decision has
      // been made yet to surface a per-case recalculation outcome here.
      show({ variant: "success", message: "Round deleted.", duration: 2500 });
    },
    onError: (error) => {
      show({ variant: "error", message: describeQueryError(error, "Couldn't delete this round. Try again.") });
    },
  });

  function renderActions(item: PlayerRoundListItem) {
    // ghs#193: Edit and Delete now have genuinely different eligibility
    // -- Edit broadened to AMENDABLE_ROUND_STATUSES (a player may correct
    // a pending round's hole scores too), Delete stays the narrower,
    // unchanged EDITABLE_ROUND_STATUSES (player-initiated delete of a
    // pending round was explicit non-scope for that issue). Neither
    // renders at all once a round is 'approved', so this still returns
    // null outright in that case rather than an empty action row.
    const canEdit = AMENDABLE_ROUND_STATUSES.has(item.status);
    const canDelete = EDITABLE_ROUND_STATUSES.has(item.status);
    if (!canEdit && !canDelete) return null;
    // ghs#134: icon-only within this ListView -- see AdminAccountsPage's
    // own renderActions for the same reasoning.
    // ghs#166: content mirrors each button's own aria-label -- single
    // source of truth, not a second copy that can drift.
    const editLabel = `Edit round at ${item.courseName}`;
    const deleteLabel = `Delete round at ${item.courseName}`;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Tooltip content={editLabel}>
            <Button variant="secondary" size="sm" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} aria-label={editLabel} onClick={() => navigate(`/rounds/${item.id}`)} />
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip content={deleteLabel}>
            <Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} aria-label={deleteLabel} onClick={() => setDeleteTarget(item)} />
          </Tooltip>
        )}
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
        <Button icon={<Plus aria-hidden="true" className="h-4 w-4" />} onClick={() => navigate("/rounds/new")}>
          New round
        </Button>
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
            <Button variant="secondary" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={() => setDeleteTarget(null)}>
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
