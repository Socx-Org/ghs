import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, HandicapTrendWidget, RecentRoundsWidget } from "../components";
import { ApiError, getMyPlayerProfile, getPlayerHandicapHistory, getPlayerRounds } from "../lib/api";

// ghs#65: the player's real landing screen after login -- current
// handicap index and recent rounds.
//
// ghs#116: the recent-rounds table is RecentRoundsWidget (Widget
// primitive, design doc sections 9.1/10) -- same data, same navigation,
// capped to 3 rounds per the design doc's own explicit wording.
//
// ghs#117: the handicap-index card is now HandicapTrendWidget -- a real
// line chart over handicap_history, not just the current index. Same
// "New round"-style idle-vs-hidden discipline as RecentRoundsWidget
// (ghs#116 review fix, PR #173): the widget itself always renders, only
// its body goes idle when there's no playerId to fetch history for.

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
  const hasPlayerId = Boolean(playerId);
  const historyQuery = useQuery({
    queryKey: ["players", playerId, "handicap-history"],
    queryFn: () => getPlayerHandicapHistory(playerId!),
    enabled: hasPlayerId,
  });
  const roundsQuery = useQuery({
    queryKey: ["players", playerId, "rounds"],
    queryFn: () => getPlayerRounds(playerId!),
    enabled: hasPlayerId,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      {/* ghs#117: this is now the one place a failed profile load
          surfaces (the standalone Card+Alert it used to live in is
          gone) -- a real isError, not idle, since there's no longer a
          second surface elsewhere on the page to call "already shown".
          isLoading guards against TanStack Query's own documented
          behaviour for a disabled query (historyQuery, gated on
          hasPlayerId): it never resolves out of "pending" on its own,
          so it's only consulted once there IS a playerId to fetch with
          -- otherwise this would show a loading skeleton forever
          instead of the real error (the exact bug class review finding
          PR #91 fixed for RecentRoundsWidget below). */}
      <HandicapTrendWidget
        isLoading={profileQuery.isPending || (hasPlayerId && historyQuery.isPending)}
        isError={profileQuery.isError || historyQuery.isError}
        errorMessage={
          profileQuery.isError
            ? describeQueryError(profileQuery.error, "Couldn't load your handicap index. Try refreshing the page.")
            : historyQuery.isError
              ? describeQueryError(historyQuery.error, "Couldn't load your handicap history. Try refreshing the page.")
              : undefined
        }
        history={historyQuery.data ?? []}
      />

      {/* Review finding, PR #173: the widget itself (including its
          "New round" action) always renders, even when the profile
          failed to load -- only its BODY goes idle (isIdle), matching
          the pre-#116 behaviour where the card header rendered
          unconditionally and only the body went blank. There's no
          playerId to fetch rounds for at all in that case -- the
          widget above already surfaces the real failure; a second,
          redundant error (or a skeleton that can never resolve, since a
          disabled query stays isPending forever -- review finding, PR
          #91) here would just be noise. */}
      <RecentRoundsWidget
        isIdle={profileQuery.isError}
        isLoading={profileQuery.isPending || (hasPlayerId && roundsQuery.isPending)}
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
