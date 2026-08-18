import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getGeneration, getTokens, setTokens } from "./auth-store";
import type { AuthTokens } from "./auth-store";
import type { UserRole } from "../types/domain";

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
