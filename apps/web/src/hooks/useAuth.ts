import { useSyncExternalStore } from "react";
import { getUser, subscribe } from "../lib/auth-store";
import { logout as logoutRequest } from "../lib/api";

// useSyncExternalStore, not a Context provider -- the auth store
// (lib/auth-store.ts) is a plain module api.ts's interceptors also read
// and write synchronously outside of React; a Context wrapping it would
// just be a second representation of the same state to keep in sync,
// not a different source of truth.
export function useAuth() {
  const user = useSyncExternalStore(subscribe, getUser);
  return {
    user,
    isAuthenticated: user !== null,
    logout: logoutRequest,
  };
}
