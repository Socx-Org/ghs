import type { PlayerRoundListItem } from "../types/domain";

// ghs#213: extracted from RecentRoundsWidget.tsx (ghs#205, its original
// and only caller until this issue) -- MyRoundsPage is now a second real
// caller of the exact same rule, so it lives here rather than being
// redefined a second time. Same rule RoundDetailsPage's own Stat
// established first (ghs#168): a round's real score exists at
// submission time, before approval, but stays hidden from the player
// until the round is actually approved.
//
// Review finding, PR #214: the numeric form is exported in its own
// right, not just used internally by displayGrossScore below -- a
// second caller (MyRoundsPage's Score sort accessor) needs the same
// withheld-aware value as a real `number | null`, not a display
// string, and re-implementing the `status === "approved"` check a
// second time there would risk the two silently drifting apart.
export function effectiveGrossScore(round: PlayerRoundListItem): number | null {
  return round.status === "approved" ? round.grossScore : null;
}

export function displayGrossScore(round: PlayerRoundListItem): string {
  return String(effectiveGrossScore(round) ?? "—");
}
