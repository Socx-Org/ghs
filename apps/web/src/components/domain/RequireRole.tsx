import type { ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";
import type { UserRole } from "../../types/domain";

export interface RequireRoleProps {
  role: UserRole | UserRole[];
  children: ReactNode;
  /** Rendered instead of children when the gate fails. Defaults to nothing. */
  fallback?: ReactNode;
}

// Router-agnostic by design -- no react-router-dom exists in this repo
// yet (deliberately deferred; nothing has needed real multi-screen
// navigation before now), so this gates *rendering*, not navigation.
// It does not redirect anywhere. Once a real router is introduced
// (likely #64, the first screen that needs one), wrap this with whatever
// route-level redirect that router's own idioms call for -- this stays
// the reusable "does the current user's role satisfy X" primitive
// underneath it either way.
//
// UX-only, like every other client-side role check in this app: the
// backend is the sole authorization authority on every real request
// (verified directly -- see apps/api/src/application/auth-provider.ts),
// this just avoids flashing UI the user can't act on anyway.
export function RequireRole({ role, children, fallback = null }: RequireRoleProps) {
  const { user } = useAuth();
  const allowedRoles = Array.isArray(role) ? role : [role];

  if (!user || !allowedRoles.includes(user.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
