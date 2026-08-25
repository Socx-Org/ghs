import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Alert, Button, Card, CardBody, EmptyState, ListView, Modal, RoundStatusBadge, Skeleton, TableCell, TableHeaderCell, useToast } from "../components";
import { ApiError, deleteRound, listAdminRounds } from "../lib/api";
import { ROUND_STATUS_OPTIONS } from "../lib/domain-labels";
import type { AdminRoundListItem } from "../types/domain";

// ghs#113: the general admin all-rounds browser -- distinct from the
// existing pending-only queue (#67, AdminPendingQueuePage), which stays
// deliberately narrow. This one spans every status, backed by GET
// /admin/rounds (#100). listAdminRounds() itself still relies entirely
// on the backend's own defaults (no server-side filter/pagination
// params) -- narrowing the result happens client-side, via ListView's
// own search/filter (ghs#137, sourced from RoundStatusBadge's own
// ROUND_STATUS_OPTIONS, not redefined here); pagination is #138, a
// separate, still-open issue, not yet added here.
//
// ghs#115: a per-row delete action, admin-only, real confirmation Modal
// (never window.confirm()). Unlike AdminRoundReviewPage's own delete
// (which already has the full round loaded, so its confirmation can
// name whether THIS round has a recorded score), this list's own
// AdminRoundListItem row shape has no scoreDifferential -- the
// confirmation here is deliberately general; the real per-round
// outcome is still surfaced honestly afterward, via the toast, from the
// actual DELETE response.

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function AdminRoundsListPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<AdminRoundListItem | null>(null);

  const roundsQuery = useQuery({ queryKey: ["admin", "rounds"], queryFn: listAdminRounds });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRound(id),
    onSuccess: (result, id) => {
      // Review finding, PR #145: the app-wide QueryClient (App.tsx)
      // caches across routes -- if this round's own ["rounds", id]
      // query was ever populated (e.g. the admin had visited its
      // review screen before returning here), it would otherwise stay
      // cached and stale until its own background refetch eventually
      // discovers the 404. Removed outright, same as
      // AdminRoundReviewPage's own delete handling, rather than left to
      // go stale.
      queryClient.removeQueries({ queryKey: ["rounds", id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "rounds"] });
      setDeleteTarget(null);
      show({
        variant: "success",
        message: result.recalculated ? "Round deleted. The player's handicap has been recalculated." : "Round deleted.",
        duration: 3000,
      });
    },
    onError: (error) => {
      // Deliberately doesn't close the modal here -- same convention as
      // account/course/tee-configuration delete (#98/#111/#112): the
      // admin can see the toast and retry from the still-open
      // confirmation.
      show({ variant: "error", message: describeQueryError(error, "Couldn't delete this round. Try again.") });
    },
  });

  function renderActions(item: AdminRoundListItem) {
    return (
      <Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} onClick={() => setDeleteTarget(item)}>
        Delete
      </Button>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div>
        <h1 className="mt-4 text-2xl font-semibold text-text">All rounds</h1>
        <p className="mt-2 text-sm text-text-muted">Every round across every player, regardless of status.</p>
      </div>

      <Card className="mt-8">
        <CardBody>
          {roundsQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          ) : roundsQuery.isError ? (
            <Alert variant="error">{describeQueryError(roundsQuery.error, "Couldn't load rounds. Try refreshing the page.")}</Alert>
          ) : (
            <ListView<AdminRoundListItem>
              id="admin-rounds"
              items={roundsQuery.data.items}
              getKey={(item) => item.id}
              searchPlaceholder="Search by player, course, or tee…"
              getSearchText={(item) => `${item.playerFirstName} ${item.playerLastName} ${item.courseName} ${item.teeConfigurationName}`}
              filters={[{ id: "status", label: "Status", getValue: (item) => item.status, options: ROUND_STATUS_OPTIONS }]}
              tableHead={
                <>
                  <TableHeaderCell>Player</TableHeaderCell>
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
                    <Link to={`/admin/rounds/${item.id}`} className="font-medium text-primary hover:underline">
                      {item.playerFirstName} {item.playerLastName}
                    </Link>
                  </TableCell>
                  <TableCell>{item.courseName}</TableCell>
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
                      <Link to={`/admin/rounds/${item.id}`} className="text-sm font-medium text-primary hover:underline">
                        {item.playerFirstName} {item.playerLastName}
                      </Link>
                      <RoundStatusBadge status={item.status} />
                    </div>
                    <p className="text-xs text-text-muted">
                      {item.courseName} · {item.teeConfigurationName}
                    </p>
                    <p className="text-xs text-text-muted">{formatPlayedAt(item.playedAt)}</p>
                    <div>{renderActions(item)}</div>
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="No rounds yet" description="Rounds created by players or on their behalf will show up here." />}
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
          Delete {deleteTarget?.playerFirstName} {deleteTarget?.playerLastName}'s round permanently? This can't be undone.
          If it had a recorded score, their handicap will be recalculated.
        </p>
      </Modal>
    </div>
  );
}
