// Mirrors the backend's own types exactly (apps/api/src/data/rounds.repository.ts
// RoundStatus, apps/api/src/data/users.repository.ts UserRole) -- the
// canonical source for both, not superseded by #63's API client/auth
// layer (lib/api.ts, lib/auth-store.ts). UserRole is imported from here
// into AuthUser rather than a second copy living alongside the JWT
// claims that populate it. If these ever drift from the backend, that's
// a bug to fix, not an intentional frontend-only variation.
export type RoundStatus = "draft" | "pending" | "approved" | "rejected" | "amending";

export type UserRole = "player" | "admin" | "super_admin";

// Mirrors apps/api/src/interface/http/routes/players.ts's
// toPlayerProfileResponse (ghs#60/#89) -- userId deliberately excluded,
// same reasoning as the backend's own DTO (PR #75: an internal
// auth-linkage key, not profile data).
export interface PlayerProfile {
  id: string;
  clubId: string | null;
  firstName: string;
  lastName: string;
  country: string;
  createdAt: string;
  handicapIndex: number | null;
  lowHandicapIndex: number | null;
}

// Mirrors apps/api/src/data/rounds.repository.ts's RoundSummary
// (toRoundSummary) -- the shape GET /players/:playerId/rounds returns.
export interface RoundSummary {
  id: string;
  playerId: string;
  teeConfigurationId: string;
  playedAt: string;
  status: RoundStatus;
}
