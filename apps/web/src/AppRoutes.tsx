import { Navigate, Route, Routes } from "react-router-dom";
import ComponentsCatalogue from "./ComponentsCatalogue";
import { useAuth } from "./hooks/useAuth";
import AdminCreateUserPage from "./pages/AdminCreateUserPage";
import DashboardPlaceholder from "./pages/DashboardPlaceholder";
import LoginPage from "./pages/LoginPage";
import PlayerDashboardPage from "./pages/PlayerDashboardPage";
import { RedirectIfAuthenticated } from "./routes/RedirectIfAuthenticated";
import { RequireAdmin } from "./routes/RequireAdmin";
import { RequireAuth } from "./routes/RequireAuth";

// ghs#65: player is the only role with a real landing screen so far --
// admin/super_admin still get DashboardPlaceholder (its own Admin nav
// entry point is all they need today; a real admin dashboard is future
// scope, not invented here). A small dispatcher rather than two
// separate routes, since both live at the same "/" path.
function HomeRoute() {
  const { user } = useAuth();
  return user?.role === "player" ? <PlayerDashboardPage /> : <DashboardPlaceholder />;
}

// Extracted from App.tsx so tests can drive it inside a MemoryRouter
// (controlling the initial route directly) instead of the real
// BrowserRouter, which reads from window.location.
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthenticated />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomeRoute />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin/users/new" element={<AdminCreateUserPage />} />
        </Route>
      </Route>
      {/* ghs#78's own stated intention: "once real application routing
          is introduced, the catalogue can become a development-only
          /components route." This is that moment -- MODE, not
          import.meta.env.DEV (also true under Vitest's test mode,
          verified directly in App.tsx's original scaffold version). */}
      {import.meta.env.MODE === "development" && <Route path="/dev/components" element={<ComponentsCatalogue />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
