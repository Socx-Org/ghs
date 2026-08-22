import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getGeneration, getTokens, setTokens } from "./auth-store";
import type { AuthTokens } from "./auth-store";
import type { AccountProfile, AdminRoundListItem, AdminUserListItem, Course, CourseSummary, FairwayResult, HoleScore, PendingRoundQueueItem, PlayerProfile, PlayerRoundListItem, Round, TeeConfiguration, TeeConfigurationInput, UserRole, UserStatus } from "../types/domain";

// Relative baseURL, not an absolute VITE_API_URL env var -- the Vite dev
// proxy (vite.config.ts) and the real deployed nginx config (ADR'd in
// ghs#57/deploy/nginx-ghs.conf) both already put the frontend and API on
// the same origin, in every environment this app actually runs in. An
// env-configurable absolute URL would be unused configurability with no
// real scenario behind it.
const BASE_URL = "/api/v1";

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    return data?.error ?? error.message;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

// login/verifyMfa/refresh all capture auth-store's generation counter
// before their request and check it again once the response arrives --
// if setTokens() ran in the meantime (most concretely: the user logged
// out while a background refresh was in flight), applying this response
// now would resurrect session state that was just explicitly cleared.
// Throwing here rather than silently skipping setTokens() and returning
// "success" anyway -- a caller getting back a truthy TokenPair for a
// login that was never actually persisted would be a worse trap (review
// finding, PR #84).
function assertSessionUnchangedSince(generationAtRequest: number): void {
  if (getGeneration() !== generationAtRequest) {
    throw new ApiError("Session changed while this request was in flight", 409);
  }
}

// Deliberately NOT the `api` instance below -- login/mfa-verify/refresh/
// logout are the auth *bootstrap* flow itself. Routing them through
// api's request interceptor would attach a (nonexistent, for login/mfa)
// or nonsensical (for refresh) Authorization header; routing them
// through its response interceptor would treat login's "invalid
// credentials" 401 as an expired-session case and try to refresh in a
// loop, or try to refresh in response to /auth/refresh's own 401.
// Exported so tests can mock it independently of `api` -- axios-mock-
// adapter attaches per-instance, and this genuinely is a second instance
// (see the comment above), not an implementation detail to hide.
export const bootstrapClient = axios.create({ baseURL: BASE_URL });

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const tokens = getTokens();
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

// Single-flight: concurrent 401s all await this same in-flight promise
// instead of each calling /auth/refresh themselves (acceptance
// criterion -- verified in api.test.ts with N simultaneous 401s
// asserting exactly one refresh call).
let refreshPromise: Promise<AuthTokens> | null = null;

async function refreshTokens(): Promise<AuthTokens> {
  const current = getTokens();
  if (!current?.refreshToken) {
    throw new ApiError("No refresh token available", 401);
  }
  const generationAtRequest = getGeneration();
  const { data } = await bootstrapClient.post<AuthTokens>("/auth/refresh", {
    refreshToken: current.refreshToken,
  });
  assertSessionUnchangedSince(generationAtRequest);
  setTokens(data);
  return data;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;

    if (status === 401 && config && !config._retried) {
      config._retried = true;
      try {
        if (!refreshPromise) {
          refreshPromise = refreshTokens().finally(() => {
            refreshPromise = null;
          });
        }
        const newTokens = await refreshPromise;
        config.headers.Authorization = `Bearer ${newTokens.accessToken}`;
        return api(config);
      } catch {
        // A revoked/reused/expired refresh token fails cleanly here --
        // session state is cleared unconditionally rather than left
        // half-authenticated, and the *original* caller's promise
        // rejects with a clean ApiError instead of the raw refresh
        // failure (acceptance criterion).
        setTokens(null);
        return Promise.reject(new ApiError("Session expired", 401));
      }
    }

    return Promise.reject(new ApiError(errorMessage(error), status));
  },
);

export interface LoginRequest {
  email: string;
  password: string;
}

export type LoginResult = { mfaRequired: true; mfaPendingToken: string } | (AuthTokens & { mfaRequired?: never });

export async function login(input: LoginRequest): Promise<LoginResult> {
  const generationAtRequest = getGeneration();
  try {
    const { data } = await bootstrapClient.post<LoginResult>("/auth/login", input);
    if (!data.mfaRequired) {
      assertSessionUnchangedSince(generationAtRequest);
      setTokens(data);
    }
    return data;
  } catch (error) {
    // Pass an ApiError we raised ourselves (the staleness guard above)
    // through unchanged -- re-wrapping it via errorMessage()/
    // axios.isAxiosError() below would lose its .status (it's not an
    // axios error) and just re-derive the same .message anyway.
    if (error instanceof ApiError) throw error;
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

export interface MfaVerifyRequest {
  mfaPendingToken: string;
  code: string;
}

export async function verifyMfa(input: MfaVerifyRequest): Promise<AuthTokens> {
  const generationAtRequest = getGeneration();
  try {
    const { data } = await bootstrapClient.post<AuthTokens>("/auth/mfa/verify", input);
    assertSessionUnchangedSince(generationAtRequest);
    setTokens(data);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

// ghs#105. bootstrapClient, not api -- unauthenticated, no session to
// attach a bearer token to, same reasoning as login/verifyMfa above.
// No tokens returned/set: registration doesn't log the caller in, it
// starts the activation flow.
export async function register(input: RegisterRequest): Promise<{ message: string }> {
  try {
    const { data } = await bootstrapClient.post<{ message: string }>("/auth/register", input);
    return data;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

// ghs#105. Unauthenticated -- an anonymous visitor on LoginPage needs
// this before any session exists, to decide whether to show a "Create
// an account" entry point at all.
export async function getSelfRegistrationEnabled(): Promise<boolean> {
  try {
    const { data } = await bootstrapClient.get<{ enabled: boolean }>("/auth/self-registration-enabled");
    return data.enabled;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

// ghs#106. Unauthenticated, same bootstrapClient reasoning as above.
// error.message is one of the backend's own stable codes on failure
// (expired_token | already_used_token | invalid_token) -- ActivationPage
// maps these itself, this function doesn't turn them into copy.
export async function activateAccount(token: string): Promise<{ message: string }> {
  try {
    const { data } = await bootstrapClient.post<{ message: string }>("/auth/activate", { token });
    return data;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

// ghs#106. Always the same response regardless of whether the email
// exists or the account already needs activation -- the backend's own
// enumeration protection; the UI must not contradict it.
export async function resendActivation(email: string): Promise<{ message: string }> {
  try {
    const { data } = await bootstrapClient.post<{ message: string }>("/auth/resend-activation", { email });
    return data;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

// ghs#107. Always the same response regardless of whether the email is
// registered -- the backend's own enumeration protection; the UI must
// not contradict it.
export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  try {
    const { data } = await bootstrapClient.post<{ message: string }>("/auth/password-reset/request", { email });
    return data;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<{ message: string }> {
  try {
    const { data } = await bootstrapClient.post<{ message: string }>("/auth/password-reset/confirm", { token, newPassword });
    return data;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

// ghs#98. Routed through `api`, same reasoning as createUser/
// getMyPlayerProfile below -- an ordinary authenticated feature call,
// not part of the auth bootstrap flow. Unlike getMyPlayerProfile,
// works for every role (admin/super_admin have no players row at all).
export async function getMe(): Promise<AccountProfile> {
  const { data } = await api.get<AccountProfile>("/auth/me");
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>("/auth/change-password", { currentPassword, newPassword });
  return data;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  autoActivate: boolean;
}

export interface CreateUserResult {
  userId: string;
}

// ghs#86. Routed through `api`, not bootstrapClient -- unlike login/
// verifyMfa/refresh/logout (the auth bootstrap flow itself), this is a
// real authenticated feature call: it needs the bearer token api's
// request interceptor attaches, and its response interceptor already
// normalises any failure into an ApiError (including a 401 -> refresh
// retry), so there's no need to duplicate that wrapping here.
export async function createUser(input: CreateUserRequest): Promise<CreateUserResult> {
  const { data } = await api.post<CreateUserResult>("/admin/users", input);
  return data;
}

export interface ListUsersResult {
  items: AdminUserListItem[];
  total: number;
}

// ghs#104. No filter/pagination params sent -- the backend's own
// defaults (limit 50, no filter) are the entire scope this issue's own
// list screen needs; a UI for filtering/pagination is explicit
// non-scope (see the issue), not merely unimplemented.
//
// ghs#114: an optional role filter, added for the admin round-creation
// player-selector's own real need (only ever wants role=player) --
// the backend already accepts this query param (RBAC-tested), this was
// just never threaded through the frontend client before now. Kept
// optional so AdminAccountsPage's own existing no-filter call is
// unaffected.
export async function listUsers(filter?: { role?: UserRole }): Promise<ListUsersResult> {
  const { data } = await api.get<ListUsersResult>("/admin/users", { params: filter });
  return data;
}

export async function setUserStatus(userId: string, status: Extract<UserStatus, "active" | "disabled">): Promise<void> {
  await api.patch(`/admin/users/${userId}/status`, { status });
}

export async function deleteUser(userId: string): Promise<void> {
  await api.delete(`/admin/users/${userId}`);
}

// ghs#65. Routed through `api`, same reasoning as createUser above --
// both are ordinary authenticated feature calls, not part of the auth
// bootstrap flow.
export async function getMyPlayerProfile(): Promise<PlayerProfile> {
  const { data } = await api.get<PlayerProfile>("/players/me");
  return data;
}

export async function getPlayerRounds(playerId: string): Promise<PlayerRoundListItem[]> {
  const { data } = await api.get<PlayerRoundListItem[]>(`/players/${playerId}/rounds`);
  return data;
}

// ghs#67. GET /players/:id -- same response shape as GET /players/me
// (toPlayerProfileResponse), authorized for admin/super_admin (or the
// owning player) by the backend itself. Used to show the real player's
// name on the round-review screen, which only ever gets a bare
// playerId from GET /rounds/:id.
export async function getPlayer(id: string): Promise<PlayerProfile> {
  const { data } = await api.get<PlayerProfile>(`/players/${id}`);
  return data;
}

// ghs#94. GET /courses and GET /courses/:id are unauthenticated on the
// backend (public reference data), but routed through `api` anyway for
// a single consistent client -- the request interceptor attaching a
// bearer token when one exists is harmless, the backend simply ignores
// it on these routes.
export async function listCourses(): Promise<CourseSummary[]> {
  const { data } = await api.get<CourseSummary[]>("/courses");
  return data;
}

export async function getCourse(id: string): Promise<Course> {
  const { data } = await api.get<Course>(`/courses/${id}`);
  return data;
}

export interface CreateCourseRequest {
  name: string;
  city?: string;
  country?: string;
  // ghs#155: POST /courses already accepted this nested array (ghs#94's
  // tee-configuration lookups needed it on the backend); the CSV import
  // path is this request type's first real caller to actually populate
  // it -- manual entry (CreateCoursePage's own form) still never does,
  // by ghs#110's own design (tee configurations are added afterward, via
  // CourseDetailPage).
  teeConfigurations?: TeeConfigurationInput[];
}

// ghs#110. POST /courses already existed (ghs#94's tee-configuration
// lookups needed it); this is its first real create-a-course caller.
export async function createCourse(input: CreateCourseRequest): Promise<Course> {
  const { data } = await api.post<Course>("/courses", input);
  return data;
}

// ghs#110/#99. Partial update -- undefined/omitted means "leave this
// field alone" (matching the backend's own PATCH /courses/:id
// semantics), null explicitly clears city/country. Every field is
// still sent on every real submission from CourseEditForm (see that
// component) -- there's no dirty-field tracking here, just the type
// distinguishing "not part of this request" from "clear it".
export interface UpdateCourseRequest {
  name?: string;
  city?: string | null;
  country?: string | null;
}

export async function updateCourse(id: string, input: UpdateCourseRequest): Promise<Course> {
  const { data } = await api.patch<Course>(`/courses/${id}`, input);
  return data;
}

// ghs#111. On a 409 conflict, error.message is the backend's own stable
// code ("course_has_rounds") -- not human-facing copy, same convention
// as the auth token-classification errors (ghs#106/#107). The caller
// maps it, this function doesn't turn it into copy itself.
export async function deleteCourse(id: string): Promise<void> {
  await api.delete(`/courses/${id}`);
}

export interface CreateRoundInput {
  playerId: string;
  teeConfigurationId: string;
  playedAt: string;
  isTournament?: boolean;
  is9Hole?: boolean;
}

export async function createRound(input: CreateRoundInput): Promise<Round> {
  const { data } = await api.post<Round>("/rounds", input);
  return data;
}

export async function getRound(id: string): Promise<Round> {
  const { data } = await api.get<Round>(`/rounds/${id}`);
  return data;
}

export async function getTeeConfiguration(id: string): Promise<TeeConfiguration> {
  const { data } = await api.get<TeeConfiguration>(`/tee-configurations/${id}`);
  return data;
}

// ghs#112. Standalone tee-configuration creation on an existing course
// (ghs#99) -- reused for the one real tee-configuration create/edit
// component this app has (TeeConfigurationForm), not a page-specific
// duplicate.
export async function createTeeConfiguration(courseId: string, input: TeeConfigurationInput): Promise<TeeConfiguration> {
  const { data } = await api.post<TeeConfiguration>(`/courses/${courseId}/tee-configurations`, input);
  return data;
}

// Full replacement, same shape as createTeeConfiguration (ghs#99).
export async function updateTeeConfiguration(id: string, input: TeeConfigurationInput): Promise<TeeConfiguration> {
  const { data } = await api.patch<TeeConfiguration>(`/tee-configurations/${id}`, input);
  return data;
}

// On a 409 conflict, error.message is the backend's own stable code
// ("tee_configuration_has_rounds") -- same convention as deleteCourse.
export async function deleteTeeConfiguration(id: string): Promise<void> {
  await api.delete(`/tee-configurations/${id}`);
}

export interface AddHoleScoreInput {
  holeNumber: number;
  strokes: number;
  putts?: number;
  gir?: boolean;
  fairwayResult?: FairwayResult;
  inSand?: boolean;
  penalties?: number;
}

// ghs#92's real upsert -- an omitted optional field preserves whatever
// was already recorded for that hole, it does not reset it. Only the
// fields the caller actually includes here are sent at all (see
// HoleEntryCard, which only spreads in fields the player touched).
export async function addHoleScore(roundId: string, input: AddHoleScoreInput): Promise<HoleScore> {
  const { data } = await api.post<HoleScore>(`/rounds/${roundId}/holes`, input);
  return data;
}

export async function submitRound(roundId: string): Promise<Round> {
  const { data } = await api.post<{ round: Round }>(`/rounds/${roundId}/submit`);
  return data.round;
}

// ghs#67. Deliberately narrow -- no pagination/filtering/sorting query
// params, matching the backend's own approved scope (rounds.ts's own
// comment). Not a generic admin rounds browser -- that's #113,
// GET /admin/rounds, a separate endpoint entirely.
export async function listPendingRounds(): Promise<PendingRoundQueueItem[]> {
  const { data } = await api.get<PendingRoundQueueItem[]>("/admin/rounds/pending");
  return data;
}

export async function approveRound(id: string): Promise<Round> {
  const { data } = await api.patch<Round>(`/rounds/${id}/status`, { status: "approved" });
  return data;
}

export async function rejectRound(id: string, rejectionReason: string): Promise<Round> {
  const { data } = await api.patch<Round>(`/rounds/${id}/status`, { status: "rejected", rejectionReason });
  return data;
}

export interface DeleteRoundResult {
  // ghs#115: whether the deletion actually triggered a real handicap
  // recalculation -- rounds.service.ts's deleteRound only recalculates
  // when the round had a real scoreDifferential (an approved round with
  // a differential); a draft/pending/rejected round never did, so
  // deleting one is a no-op for the player's handicap. The full
  // RecalculationOutcome isn't otherwise modelled on this side (nothing
  // else needs it) -- reduced to just the one boolean the confirmation
  // messaging actually needs, not exposed wholesale.
  recalculated: boolean;
}

export async function deleteRound(id: string): Promise<DeleteRoundResult> {
  const { data } = await api.delete<{ recalculation: unknown | null }>(`/rounds/${id}`);
  return { recalculated: data.recalculation !== null };
}

export interface ListAdminRoundsResult {
  items: AdminRoundListItem[];
  total: number;
}

// ghs#113. No filter/pagination params sent, same reasoning as
// listUsers above (ghs#104) -- the backend's own defaults (limit 50, no
// filter) are the entire scope this issue's own list screen needs; a
// UI for filtering/pagination is a separate, still-open issue (#138),
// not merely unimplemented here.
export async function listAdminRounds(): Promise<ListAdminRoundsResult> {
  const { data } = await api.get<ListAdminRoundsResult>("/admin/rounds");
  return data;
}

// Always clears local state, regardless of whether the network call
// itself succeeds -- matches the backend's own logout route, which is
// deliberately idempotent and always returns 200 (verified directly,
// apps/api/src/interface/http/routes/auth.ts) specifically so the
// frontend never has to branch on the response here.
export async function logout(): Promise<void> {
  const tokens = getTokens();
  try {
    if (tokens?.refreshToken) {
      await bootstrapClient.post("/auth/logout", { refreshToken: tokens.refreshToken });
    }
  } catch {
    // Deliberately ignored -- see comment above.
  } finally {
    setTokens(null);
  }
}
