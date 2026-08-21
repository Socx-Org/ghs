// Mirrors the backend's own types exactly (apps/api/src/data/rounds.repository.ts
// RoundStatus, apps/api/src/data/users.repository.ts UserRole) -- the
// canonical source for both, not superseded by #63's API client/auth
// layer (lib/api.ts, lib/auth-store.ts). UserRole is imported from here
// into AuthUser rather than a second copy living alongside the JWT
// claims that populate it. If these ever drift from the backend, that's
// a bug to fix, not an intentional frontend-only variation.
export type RoundStatus = "draft" | "pending" | "approved" | "rejected" | "amending";

export type UserRole = "player" | "admin" | "super_admin";

export type UserStatus = "pending_verification" | "active" | "disabled" | "deleted";

// Mirrors apps/api/src/application/admin-users.service.ts's
// AdminUserListItem exactly (ghs#98) -- firstName/lastName are null for
// admin/super_admin accounts, which have no linked players row at all
// (IAM-020's strict separation; adminCreateUser only ever links one for
// role === "player"). Not a data gap to paper over on this side either.
export interface AdminUserListItem {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  firstName: string | null;
  lastName: string | null;
  // ghs#114: the players table's own id, distinct from `id` above (a
  // users table id) -- needed to create a round on this account's
  // behalf (POST /rounds' playerId), same null-for-non-player reasoning
  // as firstName/lastName.
  playerId: string | null;
}

// Mirrors apps/api/src/application/auth.service.ts's AccountProfile
// exactly (ghs#98) -- the account-level counterpart to PlayerProfile
// below, returned by GET /auth/me. Works for every role, including
// admin/super_admin (firstName/lastName null for those, same reasoning
// as AdminUserListItem).
export interface AccountProfile {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  firstName: string | null;
  lastName: string | null;
}

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

// Mirrors apps/api/src/data/rounds.repository.ts's PendingRoundQueueItem
// exactly (ghs#61/#67) -- exactly the fields a queue row needs to
// render (round id, player identity, course, tee configuration, played
// date), not the full Round shape (no hole scores/aggregate fields an
// admin doesn't need just to decide which round to open next).
export interface PendingRoundQueueItem {
  id: string;
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  courseId: string;
  courseName: string;
  teeConfigurationId: string;
  teeConfigurationName: string;
  playedAt: string;
}

// Mirrors apps/api/src/data/rounds.repository.ts's HoleScore.
export type FairwayResult = "hit" | "missed_left" | "missed_right";

export interface HoleScore {
  id: string;
  holeNumber: number;
  strokes: number;
  putts: number | null;
  gir: boolean;
  fairwayResult: FairwayResult | null;
  inSand: boolean;
  penalties: number;
  netDoubleBogeyAdjusted: number;
}

// Mirrors apps/api/src/data/rounds.repository.ts's Round -- the full
// shape GET /rounds/:id and POST /rounds return, including holeScores
// (unlike RoundSummary above). grossScore/adjustedGrossScore/
// scoreDifferential/pcc/total* all stay null until admin approval
// (ScoringService.recomputeRoundAggregates only runs then) -- the
// frontend must never treat a null grossScore during entry as "zero,"
// and must compute any running total itself from holeScores.
export interface Round {
  id: string;
  playerId: string;
  teeConfigurationId: string;
  playedAt: string;
  playingHandicap: number | null;
  grossScore: number | null;
  adjustedGrossScore: number | null;
  scoreDifferential: number | null;
  pcc: number | null;
  totalPutts: number | null;
  totalGir: number | null;
  totalFairwaysHit: number | null;
  totalPenalties: number | null;
  isTournament: boolean;
  is9Hole: boolean;
  status: RoundStatus;
  rejectionReason: string | null;
  holeScores: HoleScore[];
}

// Mirrors apps/api/src/data/courses.repository.ts's Hole/TeeConfiguration/
// Course/CourseSummary exactly.
export interface Hole {
  id: string;
  holeNumber: number;
  distanceYards: number;
  par: number;
  strokeIndex: number;
}

export interface TeeConfiguration {
  id: string;
  name: string;
  holeCount: number;
  courseRating: number;
  slopeRating: number;
  holes: Hole[];
}

// ghs#112. The create/update request shape (apps/api/src/interface/
// http/routes/courses.ts's parseTeeConfiguration) -- no ids, since
// PATCH /tee-configurations/:id is a full replacement (holes are
// deleted and reinserted wholesale, not merged, ghs#99).
export interface TeeConfigurationHoleInput {
  holeNumber: number;
  distanceYards: number;
  par: number;
  strokeIndex: number;
}

export interface TeeConfigurationInput {
  name: string;
  holeCount: 9 | 18;
  courseRating: number;
  slopeRating: number;
  holes: TeeConfigurationHoleInput[];
}

export interface CourseSummary {
  id: string;
  clubId: string | null;
  name: string;
  city: string | null;
  country: string | null;
}

export interface Course {
  id: string;
  clubId: string | null;
  name: string;
  city: string | null;
  country: string | null;
  teeConfigurations: TeeConfiguration[];
}
