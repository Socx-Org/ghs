// Mirrors the backend's own types exactly (apps/api/src/data/rounds.repository.ts
// RoundStatus, apps/api/src/data/users.repository.ts UserRole) -- the
// canonical source for both, not superseded by #63's API client/auth
// layer (lib/api.ts, lib/auth-store.ts). UserRole is imported from here
// into AuthUser rather than a second copy living alongside the JWT
// claims that populate it. If these ever drift from the backend, that's
// a bug to fix, not an intentional frontend-only variation.
export type RoundStatus = "draft" | "pending" | "approved" | "rejected" | "amending";

// ghs#147: a single shared source for "which statuses a player may still
// submit for review, or (for a non-admin caller) delete" -- previously
// redefined independently as EDITABLE_STATUSES (RoundEntryPage) and
// RESUMABLE_STATUSES (PlayerDashboardPage), both identical; a third copy
// for MyRoundsPage's own Delete-button gating was the point this stopped
// being a coincidence worth tolerating. Mirrors rounds.service.ts's own
// isEditableStatus exactly.
//
// ghs#193 narrowed this constant's remaining real purpose: hole-score
// entry, "Continue"/Edit-button gating, and RoundEntryPage's own
// form-render gate all moved to the broader AMENDABLE_ROUND_STATUSES
// below (a player may now correct hole scores on a pending round, the
// same self-correction ghs#169 already allowed for the played date).
// This narrower set survives only where "already submitted" genuinely
// means something different from "still editable": resubmitting an
// already-pending round makes no sense, and player-initiated delete of
// a pending round was explicitly out of scope for ghs#193.
export const EDITABLE_ROUND_STATUSES = new Set<RoundStatus>(["draft", "rejected", "amending"]);

// ghs#169, broadened by ghs#193: every status except 'approved' -- the
// only one a round's own score_differential is ever read from for
// handicap calculation. Originally just the played date ("a wrong played
// date is a data-entry slip a player should be able to self-correct");
// ghs#193 extends the exact same reasoning to hole scores and the
// "Edit"/"Continue" actions that lead to entering them -- a pending
// round is still awaiting a human decision, not yet locked in. Mirrors
// rounds.service.ts's own isNotYetApprovedStatus exactly.
export const AMENDABLE_ROUND_STATUSES = new Set<RoundStatus>(["draft", "pending", "rejected", "amending"]);

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

// Mirrors apps/api/src/data/handicap-history.repository.ts's
// HandicapHistoryRecord/HandicapChangeMethod exactly (ghs#101/#117) --
// the shape GET /players/:playerId/handicap-history returns, one row
// per real index change (never a synthetic "unchanged" entry --
// ghs#21's change-only write policy).
export type HandicapChangeMethod = "calculated" | "manual_override";

export interface HandicapHistoryRecord {
  id: string;
  playerId: string;
  method: HandicapChangeMethod;
  handicapIndex: number;
  previousIndex: number | null;
  reason: string | null;
  createdBy: string | null;
  calculationSnapshot: Record<string, unknown> | null;
  calculationDate: string;
  createdAt: string;
}

// Mirrors apps/api/src/data/rounds.repository.ts's PlayerRoundListItem
// exactly (ghs#147) -- the shape GET /players/:playerId/rounds returns,
// enriched with course/tee names (same reasoning as AdminRoundListItem
// below) for the "My Rounds" list to render without a per-row fetch.
// Was RoundSummary (id/playerId/teeConfigurationId/playedAt/status
// only) before ghs#147 enriched the backend query.
export interface PlayerRoundListItem {
  id: string;
  playerId: string;
  courseId: string;
  courseName: string;
  teeConfigurationId: string;
  teeConfigurationName: string;
  playedAt: string;
  status: RoundStatus;
}

// Mirrors apps/api/src/data/rounds.repository.ts's PlayerStats exactly
// (ghs#101, coursesCount added by ghs#176, puttsHolesCount added by a
// ghs#178 review fix) -- the shape GET /players/:playerId/stats
// returns, pure aggregation over a player's approved rounds'
// hole_scores. sandInteractionPercentage is deliberately "% of holes
// with a sand interaction," not a shot count -- in_sand is a per-hole
// boolean, not a count (see the backend's own doc comment on
// PlayerStats). Every percentage/average is null when there's nothing
// to divide by (e.g. roundsCount is 0, or -- for the fairway fields --
// no hole has a real fairway_result, or -- for puttsPerRound -- no
// hole has putts recorded at all) -- never NaN or a misleading 0.
export interface PlayerStats {
  roundsCount: number;
  coursesCount: number;
  holesCount: number;
  girPercentage: number | null;
  fairwayHitPercentage: number | null;
  fairwayMissedLeftPercentage: number | null;
  fairwayMissedRightPercentage: number | null;
  puttsPerRound: number | null;
  // ghs#178 review fix: the real denominator for turning onePuttHoles/
  // threePlusPuttHoles into percentages -- putts is nullable per hole,
  // so holesCount overcounts whenever any hole has strokes but no
  // putts recorded (e.g. a mostly-putts-less round would otherwise
  // misreport as "100% 2-putt," the remainder bucket silently
  // absorbing every hole with no real putts data).
  puttsHolesCount: number;
  onePuttHoles: number;
  threePlusPuttHoles: number;
  penaltiesPerRound: number | null;
  sandInteractionPercentage: number | null;
}

// Mirrors apps/api/src/application/dashboard.service.ts's
// DashboardSection<T>/PlayerDashboard exactly (ghs#176) -- GET
// /dashboard/player's per-section failure-isolated response shape.
// Each section is independently real-data-or-error, so one broken
// section (e.g. a failed stats query) never takes the other two down
// with it -- PlayerDashboardPage derives each widget's own status from
// its own section only, never from the other two.
export type DashboardSection<T> = { data: T } | { error: true };

export interface PlayerDashboard {
  handicapHistory: DashboardSection<HandicapHistoryRecord[]>;
  recentRounds: DashboardSection<PlayerRoundListItem[]>;
  stats: DashboardSection<PlayerStats>;
}

// Mirrors apps/api/src/data/users.repository.ts's UserRoleBreakdown
// exactly (ghs#180).
export interface UserRoleBreakdown {
  total: number;
  player: number;
  admin: number;
  superAdmin: number;
}

// Mirrors apps/api/src/data/rounds.repository.ts's CourseRoundRanking
// exactly (ghs#180) -- the Admin Dashboard's Top Courses widget.
export interface CourseRoundRanking {
  courseId: string;
  courseName: string;
  roundsCount: number;
}

// Mirrors apps/api/src/data/rounds.repository.ts's PlayerRoundRanking
// exactly (ghs#180) -- the Admin Dashboard's Most Active Players widget.
export interface PlayerRoundRanking {
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  roundsCount: number;
  handicapIndex: number | null;
}

// Mirrors apps/api/src/data/users.repository.ts's RegistrationTrendPoint
// exactly (ghs#180) -- one zero-filled point per day in the requested
// window, per that repository method's own generate_series technique.
export interface RegistrationTrendPoint {
  date: string;
  count: number;
}

// Mirrors admin-settings.ts's own 24h/week/month vocabulary exactly
// (ghs#195) -- the Active Right Now sparkline's admin-configurable
// comparison period.
export type ActiveUsersChartPeriod = "24h" | "week" | "month";

// Mirrors apps/api/src/data/presence-snapshots.repository.ts's
// PresenceSnapshotSeriesPoint exactly (ghs#195) -- one bucket in the
// sparkline's current-or-previous series.
export interface ActiveUsersSeriesPoint {
  timestamp: string;
  count: number;
}

// Mirrors apps/api/src/application/dashboard.service.ts's
// ActiveUsersSnapshot exactly (ghs#195) -- activeRightNow's own richer
// shape: the live 5-minute count (unchanged), plus current-vs-previous
// bucketed history for the sparkline. `period` is echoed back so the
// widget never has to independently track which admin setting produced
// this particular series.
export interface ActiveUsersSnapshot {
  current: number;
  period: ActiveUsersChartPeriod;
  series: ActiveUsersSeriesPoint[];
  previousSeries: ActiveUsersSeriesPoint[];
  hasHistory: boolean;
}

// Mirrors apps/api/src/application/dashboard.service.ts's AdminDashboard
// exactly (ghs#180) -- GET /dashboard/admin's per-section failure-
// isolated response shape, same pattern as PlayerDashboard above.
export interface AdminDashboard {
  totalUsers: DashboardSection<UserRoleBreakdown>;
  totalCourses: DashboardSection<number>;
  totalRounds: DashboardSection<{ total: number; pending: number }>;
  topCourses: DashboardSection<CourseRoundRanking[]>;
  mostActivePlayers: DashboardSection<PlayerRoundRanking[]>;
  activeRightNow: DashboardSection<ActiveUsersSnapshot>;
  userTrends: DashboardSection<RegistrationTrendPoint[]>;
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

// Mirrors apps/api/src/data/rounds.repository.ts's AdminRoundListItem
// exactly (ghs#100/#113). Same fields as PendingRoundQueueItem above plus
// status, since (unlike the pending-only queue) this list spans every
// status. ghs#168 added the four score fields -- null until a round has
// been scored at least once (draft, or amending since its last edit);
// that's a real absence to render around, not a bug.
export interface AdminRoundListItem {
  id: string;
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  courseId: string;
  courseName: string;
  teeConfigurationId: string;
  teeConfigurationName: string;
  playedAt: string;
  status: RoundStatus;
  grossScore: number | null;
  adjustedGrossScore: number | null;
  scoreDifferential: number | null;
  pcc: number | null;
}

// Mirrors apps/api/src/data/pcc.repository.ts's DailyPcc exactly.
export type PccSource = "calculated" | "override";

export interface DailyPcc {
  id: string;
  teeConfigurationId: string;
  playedOn: string;
  pcc: number;
  source: PccSource;
  updatedBy: string | null;
  updatedAt: string;
}

// Mirrors apps/api/src/application/recalculation.service.ts's
// RecalculationOutcome exactly -- one entry per player whose approved
// rounds were affected by a PCC correction (ghs#168's PATCH response).
export interface RecalculationOutcome {
  playerId: string;
  trigger: string;
  status: "eligible" | "insufficient_holes" | "insufficient_rounds" | "player_not_found" | "failed";
  handicapIndex?: number;
  historyRecordId?: string | null;
  error?: string;
}

// Mirrors apps/api/src/application/recalculation.service.ts's
// PccCorrectionOutcome exactly -- the PATCH
// /admin/tee-configurations/:id/pcc response shape.
export interface PccCorrectionOutcome {
  dailyPcc: DailyPcc;
  updatedRounds: number;
  playerRecalculations: RecalculationOutcome[];
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
// (unlike PlayerRoundListItem above, a lighter list-row projection).
// grossScore/adjustedGrossScore/scoreDifferential/pcc/total* all stay
// null until the round is first submitted (ghs#168:
// ScoringService.recomputeRoundAggregates now runs at submission, not
// approval) -- still null for a draft round, and while entering scores
// the frontend must compute any running total itself from holeScores
// rather than reading these fields. Once populated they are NOT a
// signal of approval -- see RoundDetailsPage's own status-based gate for
// why a pending/rejected round's real score is still withheld from the
// player.
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
