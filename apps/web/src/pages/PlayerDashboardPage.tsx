import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  RoundStatusBadge,
  Skeleton,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components";
import { ApiError, getMyPlayerProfile, getPlayerRounds } from "../lib/api";
import { EDITABLE_ROUND_STATUSES } from "../types/domain";

// ghs#65: the player's real landing screen after login -- current
// handicap index and recent rounds. No chart/trend view (issue's own
// non-scope: no handicap-history endpoint exists yet).

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Surfaces the API's own message (e.g. a real 404 "no player profile
// linked to this account") rather than a fixed generic string -- same
// reasoning as LoginPage's describeAuthError (review finding, PR #91).
function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// ghs#96: no header/logo/sign-out here any more -- AppShell now
// provides that chrome uniformly for every authenticated page.
export default function PlayerDashboardPage() {
  const navigate = useNavigate();

  const profileQuery = useQuery({ queryKey: ["players", "me"], queryFn: getMyPlayerProfile });
  const playerId = profileQuery.data?.id;
  const roundsQuery = useQuery({
    queryKey: ["players", playerId, "rounds"],
    queryFn: () => getPlayerRounds(playerId!),
    enabled: Boolean(playerId),
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <Card>
        <CardBody>
          {profileQuery.isPending ? (
            <Skeleton variant="text" width={140} height={32} />
          ) : profileQuery.isError ? (
            <Alert variant="error">
              {describeQueryError(profileQuery.error, "Couldn't load your handicap index. Try refreshing the page.")}
            </Alert>
          ) : profileQuery.data.handicapIndex === null ? (
            <Stat
              label="Handicap Index"
              value="Not yet established"
              hint="Submit at least 3 rounds (54 holes) to get your first handicap index."
            />
          ) : (
            <Stat label="Handicap Index" value={profileQuery.data.handicapIndex.toFixed(1)} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Recent rounds</h2>
          <Button size="sm" onClick={() => navigate("/rounds/new")}>
            New round
          </Button>
        </CardHeader>
        <CardBody>
          {profileQuery.isError ? (
            // No playerId to fetch rounds for at all -- the profile
            // card above already surfaces this failure; showing a
            // second, redundant error (or a skeleton that can never
            // resolve, since a disabled query stays isPending forever
            // -- review finding, PR #91) here would just be noise.
            null
          ) : profileQuery.isPending || roundsQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          ) : roundsQuery.isError ? (
            <Alert variant="error">
              {describeQueryError(roundsQuery.error, "Couldn't load your rounds. Try refreshing the page.")}
            </Alert>
          ) : roundsQuery.data.length === 0 ? (
            <EmptyState title="No rounds yet" description="Rounds you play and submit will show up here." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Action</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roundsQuery.data.map((round) => (
                  <TableRow key={round.id}>
                    <TableCell>{formatPlayedAt(round.playedAt)}</TableCell>
                    <TableCell>
                      <RoundStatusBadge status={round.status} />
                    </TableCell>
                    <TableCell>
                      {EDITABLE_ROUND_STATUSES.has(round.status) && (
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/rounds/${round.id}`)}>
                          Continue
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
