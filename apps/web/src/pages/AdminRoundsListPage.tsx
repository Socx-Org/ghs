import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Alert, Card, CardBody, EmptyState, ListView, RoundStatusBadge, Skeleton, TableCell, TableHeaderCell } from "../components";
import { ApiError, listAdminRounds } from "../lib/api";
import type { AdminRoundListItem } from "../types/domain";

// ghs#113: the general admin all-rounds browser -- distinct from the
// existing pending-only queue (#67, AdminPendingQueuePage), which stays
// deliberately narrow. This one spans every status, backed by GET
// /admin/rounds (#100). No filter/pagination UI here -- listAdminRounds()
// relies entirely on the backend's own defaults, same reasoning as
// AdminAccountsPage (#104): a UI for that is #138, a separate, still-open
// issue, not this one's scope.

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function AdminRoundsListPage() {
  const roundsQuery = useQuery({ queryKey: ["admin", "rounds"], queryFn: listAdminRounds });

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
              tableHead={
                <>
                  <TableHeaderCell>Player</TableHeaderCell>
                  <TableHeaderCell>Course</TableHeaderCell>
                  <TableHeaderCell>Tee</TableHeaderCell>
                  <TableHeaderCell>Played</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
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
                </>
              )}
              renderCard={(item) => (
                <Card>
                  <CardBody className="flex flex-col gap-1">
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
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="No rounds yet" description="Rounds created by players or on their behalf will show up here." />}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
