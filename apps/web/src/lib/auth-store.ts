import { decodeJwtPayload } from "./jwt";
import type { UserRole } from "../types/domain";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  sub: string;
  email: string;
  role: UserRole;
}

// Raw access-token claim names, exactly as the backend signs them
// (apps/api/src/application/auth-provider.ts's AccessTokenClaims) --
// snake_case. The backend's own camelCase Identity remap only happens
// server-side (verifyAccessToken); a client-side decode sees the raw
// JWT payload, not that remapped shape.
interface RawAccessTokenClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  amr: string[];
  ghs_role: UserRole;
  tokenType: "access";
}

const STORAGE_KEY = "ghs-auth";

function readStoredTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

function writeStoredTokens(tokens: AuthTokens | null): void {
  try {
    if (tokens) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private browsing, disabled) -- the
    // session still works for this page load via the in-memory state
    // below, it just won't survive a reload.
  }
}

function deriveUser(tokens: AuthTokens | null): AuthUser | null {
  if (!tokens) return null;
  const claims = decodeJwtPayload<RawAccessTokenClaims>(tokens.accessToken);
  if (!claims) return null;
  return { sub: claims.sub, email: claims.email, role: claims.ghs_role };
}

// Plain module-level store, not a React Context -- api.ts's interceptors
// need synchronous read/write access to the current tokens outside of
// any React render, which a Context can't provide on its own. useAuth()
// (hooks/useAuth.ts) subscribes to this via useSyncExternalStore, so
// there's a single source of truth either way, not two representations
// of the same state to keep in sync.
let tokens: AuthTokens | null = readStoredTokens();
let user: AuthUser | null = deriveUser(tokens);
const listeners = new Set<() => void>();

export function getTokens(): AuthTokens | null {
  return tokens;
}

export function getUser(): AuthUser | null {
  return user;
}

export function setTokens(next: AuthTokens | null): void {
  tokens = next;
  user = deriveUser(next);
  writeStoredTokens(next);
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
