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
    // Just the pathname, not the whole Location object -- LoginPage only
    // needs a plain string to navigate back to on success, and history
    // state should stay small/serializable rather than carrying
    // whatever arbitrary shape Location happens to have (review finding,
    // PR #85 -- this was previously written but never actually read
    // anywhere, a real "dead state" gap; now consumed in LoginPage).
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
