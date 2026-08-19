import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import ComponentsCatalogue from "./ComponentsCatalogue";
import { useAuth } from "./hooks/useAuth";
import AdminCreateUserPage from "./pages/AdminCreateUserPage";
import DashboardPlaceholder from "./pages/DashboardPlaceholder";
import LoginPage from "./pages/LoginPage";
import NewRoundPage from "./pages/NewRoundPage";
import PlayerDashboardPage from "./pages/PlayerDashboardPage";
import RoundEntryPage from "./pages/RoundEntryPage";
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
        {/* ghs#96: the real application shell, applied once at the
            route level -- every authenticated page below is now pure
            content, rendered inside AppShell's <Outlet/>. */}
        <Route element={<AppShell />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/rounds/new" element={<NewRoundPage />} />
          <Route path="/rounds/:id" element={<RoundEntryPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/users/new" element={<AdminCreateUserPage />} />
          </Route>
        </Route>
      </Route>
      {/* ghs#78's own stated intention: "once real application routing
          is introduced, the catalogue can become a development-only
          /components route." This is that moment -- MODE, not
          import.meta.env.DEV (also true under Vitest's test mode,
          verified directly in App.tsx's original scaffold version).
          Nested under AppShell too, not RequireAuth -- ghs#96's design
          doc (section 27) asks the catalogue to dogfood the real
          shell, and AppShell itself degrades gracefully with no
          authenticated user (Sidebar/AccountMenu both handle a null
          user already), so this doesn't need a real login. */}
      {import.meta.env.MODE === "development" && (
        <Route element={<AppShell />}>
          <Route path="/dev/components" element={<ComponentsCatalogue />} />
        </Route>
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
