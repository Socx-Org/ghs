import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardBody, CardHeader, HolesTable, RoundStatusBadge, Skeleton, Stat } from "../components";
import { ApiError, getPlayerRounds, getRound, getTeeConfiguration } from "../lib/api";
import { EDITABLE_ROUND_STATUSES } from "../types/domain";

// ghs#147: the player's own read-only round-detail view -- reached from
// My Rounds (MyRoundsPage), works for any status. A separate screen
// from RoundEntryPage (unchanged, still the edit/resume flow at
// /rounds/:id) -- not repurposing that already-shipped route's meaning,
// since NewRoundPage's post-create redirect and PlayerDashboardPage's
// own "Continue" button both already navigate there expecting the
// hole-entry form specifically. Ownership is enforced server-side
// (GET /rounds/:id's own authorizeForPlayer check), not just hidden
// client-side.
//
// Course name (review finding, PR #148): neither GET /rounds/:id nor
// GET /tee-configurations/:id includes it. Router state from
// MyRoundsPage (which already has it) was considered and rejected --
// it would break on a direct/refreshed visit to this URL, and this
// screen is deliberately meant to stay correct however it's reached
// (same principle AdminRoundReviewPage's own header comment states).
// Reusing the already-enriched GET /players/:playerId/rounds (#147's
// own PlayerRoundListItem) instead -- no new backend endpoint, correct
// on a deep link too, and effectively free (already cached by the time
// this screen is reached from MyRoundsPage itself).

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function RoundDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const roundQuery = useQuery({ queryKey: ["rounds", id], queryFn: () => getRound(id!), enabled: Boolean(id) });
  const teeConfigurationId = roundQuery.data?.teeConfigurationId;
  const playerId = roundQuery.data?.playerId;
  const teeQuery = useQuery({
    queryKey: ["tee-configurations", teeConfigurationId],
    queryFn: () => getTeeConfiguration(teeConfigurationId!),
    enabled: Boolean(teeConfigurationId),
  });
  // Supplementary, not blocking -- the page still renders correctly
  // (just without a course name) while this is pending or if it fails,
  // rather than gating the whole screen on a nice-to-have.
  const roundsListQuery = useQuery({
    queryKey: ["players", playerId, "rounds"],
    queryFn: () => getPlayerRounds(playerId!),
    enabled: Boolean(playerId),
  });

  const round = roundQuery.data;
  const teeConfiguration = teeQuery.data;
  const courseName = roundsListQuery.data?.find((item) => item.id === id)?.courseName;
  const isEditable = round ? EDITABLE_ROUND_STATUSES.has(round.status) : false;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/rounds")}>
          ← Back to My Rounds
        </Button>
      </div>

      {roundQuery.isPending || (teeConfigurationId && teeQuery.isPending) ? (
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
              <div>
                <h1 className="text-lg font-semibold text-text">{courseName ?? "Course"}</h1>
                <p className="text-sm text-text-muted">{teeConfiguration.name}</p>
              </div>
              <RoundStatusBadge status={round.status} />
            </CardHeader>
            <CardBody className="flex flex-wrap gap-8">
              <Stat label="Played" value={formatPlayedAt(round.playedAt)} />
              <Stat label="Gross score" value={round.grossScore ?? "—"} />
              <Stat label="Score differential" value={round.scoreDifferential ?? "—"} />
            </CardBody>
          </Card>

          {round.status === "rejected" && round.rejectionReason && (
            <Alert variant="error" title="This round was rejected">
              {round.rejectionReason}
            </Alert>
          )}

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-text">Hole scores</h2>
            </CardHeader>
            <CardBody>
              <HolesTable holes={teeConfiguration.holes} holeScores={round.holeScores} />
            </CardBody>
          </Card>

          {isEditable && (
            <Card>
              <CardBody className="flex justify-end">
                <Button onClick={() => navigate(`/rounds/${round.id}`)}>Edit round</Button>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
