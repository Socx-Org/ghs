import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, CardBody, RecentRoundsWidget, Skeleton, Stat } from "../components";
import { ApiError, getMyPlayerProfile, getPlayerRounds } from "../lib/api";

// ghs#65: the player's real landing screen after login -- current
// handicap index and recent rounds. No chart/trend view (issue's own
// non-scope: no handicap-history endpoint exists yet).
//
// ghs#116: the recent-rounds table is now RecentRoundsWidget (Widget
// primitive, design doc sections 9.1/10) -- same data, same navigation,
// capped to 3 rounds per the design doc's own explicit wording. The
// handicap-index card stays exactly as it was; #117 (Handicap Trend
// Widget) is what eventually replaces it with a real Widget, not this
// issue's own scope.

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

      {/* Review finding, PR #173: the widget itself (including its
          "New round" action) always renders, even when the profile
          failed to load -- only its BODY goes idle (isIdle), matching
          the pre-#116 behaviour where the card header rendered
          unconditionally and only the body went blank. There's no
          playerId to fetch rounds for at all in that case -- the
          profile card above already surfaces the real failure; a
          second, redundant widget error (or a skeleton that can never
          resolve, since a disabled query stays isPending forever --
          review finding, PR #91) here would just be noise. */}
      <RecentRoundsWidget
        isIdle={profileQuery.isError}
        isLoading={profileQuery.isPending || roundsQuery.isPending}
        isError={roundsQuery.isError}
        errorMessage={roundsQuery.isError ? describeQueryError(roundsQuery.error, "Couldn't load your rounds. Try refreshing the page.") : undefined}
        rounds={roundsQuery.data ?? []}
        onContinue={(roundId) => navigate(`/rounds/${roundId}`)}
        actions={
          <Button size="sm" icon={<Plus aria-hidden="true" className="h-4 w-4" />} onClick={() => navigate("/rounds/new")}>
            New round
          </Button>
        }
      />
    </div>
  );
}
