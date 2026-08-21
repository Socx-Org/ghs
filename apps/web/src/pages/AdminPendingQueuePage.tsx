import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Alert, Card, CardBody, EmptyState, ListView, Skeleton, TableCell, TableHeaderCell } from "../components";
import { ApiError, listPendingRounds } from "../lib/api";
import type { PendingRoundQueueItem } from "../types/domain";

// ghs#67: the admin pending-review queue -- design doc's own "golden
// path" admin half. Deliberately narrow, matching GET /admin/rounds/
// pending's own approved scope (no filters/pagination/sorting) -- a
// general admin round browser is #113, a separate screen entirely, not
// folded in here. Once #100's admin-created-round auto-approval fast
// path ships, this queue only ever contains player-submitted rounds --
// no change needed here for that, just noted for context.

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function AdminPendingQueuePage() {
  const queueQuery = useQuery({ queryKey: ["admin", "rounds", "pending"], queryFn: listPendingRounds });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div>
        <h1 className="mt-4 text-2xl font-semibold text-text">Pending rounds</h1>
        <p className="mt-2 text-sm text-text-muted">Rounds submitted by players, awaiting approval or rejection.</p>
      </div>

      <Card className="mt-8">
        <CardBody>
          {queueQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          ) : queueQuery.isError ? (
            <Alert variant="error">{describeQueryError(queueQuery.error, "Couldn't load the pending queue. Try refreshing the page.")}</Alert>
          ) : (
            <ListView<PendingRoundQueueItem>
              id="pending-rounds"
              items={queueQuery.data}
              getKey={(item) => item.id}
              tableHead={
                <>
                  <TableHeaderCell>Player</TableHeaderCell>
                  <TableHeaderCell>Course</TableHeaderCell>
                  <TableHeaderCell>Tee</TableHeaderCell>
                  <TableHeaderCell>Played</TableHeaderCell>
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
                </>
              )}
              renderCard={(item) => (
                <Card>
                  <CardBody className="flex flex-col gap-1">
                    <Link to={`/admin/rounds/${item.id}`} className="text-sm font-medium text-primary hover:underline">
                      {item.playerFirstName} {item.playerLastName}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {item.courseName} · {item.teeConfigurationName}
                    </p>
                    <p className="text-xs text-text-muted">{formatPlayedAt(item.playedAt)}</p>
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="Nothing to review" description="Rounds submitted by players will show up here." />}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
