import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

// Nested inside RequireAuth (see AppRoutes.tsx) -- by the time this runs,
// the user is already known to be authenticated, so this only adds the
// role check on top rather than duplicating the auth check. A non-admin
// authenticated user is sent to "/", not "/login" (they have a valid
// session, they just can't see this particular screen).
export function RequireAdmin() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
