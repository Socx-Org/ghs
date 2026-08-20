import { Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import ComponentsCatalogue from "./ComponentsCatalogue";
import { useAuth } from "./hooks/useAuth";
import AdminAccountsPage from "./pages/AdminAccountsPage";
import AdminCreateUserPage from "./pages/AdminCreateUserPage";
import DashboardPlaceholder from "./pages/DashboardPlaceholder";
import LoginPage from "./pages/LoginPage";
import NewRoundPage from "./pages/NewRoundPage";
import NotFoundPage from "./pages/NotFoundPage";
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

// ghs#102: the catch-all route can't simply nest under RequireAuth's
// <AppShell/> branch -- RequireAuth would redirect an unauthenticated
// visitor to /login before its nested "*" child ever got a chance to
// render, which is wrong for a URL that's genuinely nonexistent (not
// merely "needs auth"). So this sits at the top level, dispatching on
// auth state itself, same pattern as HomeRoute: authenticated gets the
// real shell (AppShell now takes optional children for exactly this,
// no router nesting needed), unauthenticated gets the bare page.
function NotFoundRoute() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) {
    return (
      <AppShell>
        <NotFoundPage />
      </AppShell>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-page p-4">
      <NotFoundPage />
    </div>
  );
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
            <Route path="/admin/users" element={<AdminAccountsPage />} />
            <Route path="/admin/users/new" element={<AdminCreateUserPage />} />
          </Route>
        </Route>
      </Route>
      {/* ghs#78's own stated intention: "once real application routing
          is introduced, the catalogue can become a development-only
          /components route." This is that moment -- MODE, not
          import.meta.env.DEV (also true under Vitest's test mode,
          verified directly in App.tsx's original scaffold version).
          Deliberately NOT nested under AppShell: ComponentsCatalogue
          already renders its own live AppHeader as one of its demo
          sections (a real, functional demo of that exact component),
          so wrapping it in AppShell too would stack two header bars
          rather than have the catalogue "use" the real shell (caught
          in PR review, ghs#97). */}
      {import.meta.env.MODE === "development" && <Route path="/dev/components" element={<ComponentsCatalogue />} />}
      <Route path="*" element={<NotFoundRoute />} />
    </Routes>
  );
}
