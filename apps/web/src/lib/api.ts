import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getTokens, setTokens } from "./auth-store";
import type { AuthTokens } from "./auth-store";

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
  const { data } = await bootstrapClient.post<AuthTokens>("/auth/refresh", {
    refreshToken: current.refreshToken,
  });
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
  try {
    const { data } = await bootstrapClient.post<LoginResult>("/auth/login", input);
    if (!data.mfaRequired) {
      setTokens(data);
    }
    return data;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
}

export interface MfaVerifyRequest {
  mfaPendingToken: string;
  code: string;
}

export async function verifyMfa(input: MfaVerifyRequest): Promise<AuthTokens> {
  try {
    const { data } = await bootstrapClient.post<AuthTokens>("/auth/mfa/verify", input);
    setTokens(data);
    return data;
  } catch (error) {
    throw new ApiError(errorMessage(error), axios.isAxiosError(error) ? error.response?.status : undefined);
  }
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
