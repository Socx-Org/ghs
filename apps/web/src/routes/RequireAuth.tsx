import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

// react-router-specific -- unlike components/domain/RequireRole.tsx
// (deliberately router-agnostic, gates rendering not navigation), this
// is the actual navigation guard #63 deferred to "whichever issue first
// needs real multi-screen navigation." That's this one: a real login
// screen needs somewhere to redirect *to* on success and *from* when
// unauthenticated, which is what finally justified introducing
// react-router-dom.
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
