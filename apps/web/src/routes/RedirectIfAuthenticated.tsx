import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

// Guards /login itself -- an already-authenticated user landing there
// (e.g. a stale bookmark, browser back button) goes straight to the app
// rather than seeing a login form again.
export function RedirectIfAuthenticated() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
