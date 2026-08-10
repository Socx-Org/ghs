import type { PlayersRepository } from "../../data/players.repository.ts";

const ADMIN_ROLES = ["admin", "super_admin"];

// Shared by any route where a player-role caller may only act on their
// own linked player record, while admin/super_admin may act on any
// player's (e.g. rounds.ts, handicap-overrides.ts). Extracted once a
// second real route needed the identical check, not built speculatively.
export function createPlayerAccessAuthorizer(players: PlayersRepository) {
  return async function authorizeForPlayer(identitySub: string, ghsRole: string, targetPlayerId: string): Promise<boolean> {
    if (ADMIN_ROLES.includes(ghsRole)) return true;
    const ownPlayer = await players.findByUserId(identitySub);
    return ownPlayer !== null && ownPlayer.id === targetPlayerId;
  };
}

export { ADMIN_ROLES };
