import { Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import ComponentsCatalogue from "./ComponentsCatalogue";
import { useAuth } from "./hooks/useAuth";
import ActivationPage from "./pages/ActivationPage";
import AdminAccountsPage from "./pages/AdminAccountsPage";
import AdminCreateUserPage from "./pages/AdminCreateUserPage";
import AdminPendingQueuePage from "./pages/AdminPendingQueuePage";
import AdminRoundReviewPage from "./pages/AdminRoundReviewPage";
import CourseDetailPage from "./pages/CourseDetailPage";
import CourseListPage from "./pages/CourseListPage";
import CreateCoursePage from "./pages/CreateCoursePage";
import DashboardPlaceholder from "./pages/DashboardPlaceholder";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import LoginPage from "./pages/LoginPage";
import NewRoundPage from "./pages/NewRoundPage";
import NotFoundPage from "./pages/NotFoundPage";
import PlayerDashboardPage from "./pages/PlayerDashboardPage";
import ProfilePage from "./pages/ProfilePage";
import RegisterPage from "./pages/RegisterPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
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
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      {/* ghs#106/#107: deliberately NOT inside RedirectIfAuthenticated --
          POST /auth/activate and both password-reset endpoints are all
          completely unauthenticated and stateless, unrelated to the
          caller's own session. Redirecting an already-logged-in visitor
          away would break the legitimate case of activating a second
          account, or requesting/completing a password reset, without
          first logging out of an unrelated session. /forgot-password
          was originally (incorrectly) grouped with /login and /register
          above -- fixed here, since it needs exactly this same reasoning,
          not RedirectIfAuthenticated's (review finding, PR #125). */}
      <Route path="/activate" element={<ActivationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        {/* ghs#96: the real application shell, applied once at the
            route level -- every authenticated page below is now pure
            content, rendered inside AppShell's <Outlet/>. */}
        <Route element={<AppShell />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/courses" element={<CourseListPage />} />
          <Route path="/courses/:id" element={<CourseDetailPage />} />
          <Route path="/rounds/new" element={<NewRoundPage />} />
          <Route path="/rounds/:id" element={<RoundEntryPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/users" element={<AdminAccountsPage />} />
            <Route path="/admin/users/new" element={<AdminCreateUserPage />} />
            {/* ghs#110: admin-only at the route level, unlike
                /courses/:id (open to every role, matching GET
                /courses/:id having no backend role restriction) --
                there's no legitimate read-only experience of a create
                form the way there is for a detail view. */}
            <Route path="/courses/new" element={<CreateCoursePage />} />
            {/* ghs#67: the admin pending-review queue and its round-
                detail/approve/reject screen -- both admin-only, no
                read-only experience for a non-admin the way /courses/:id
                has (matches PATCH /rounds/:id/status and GET /admin/
                rounds/pending both being admin-gated on the backend). */}
            <Route path="/admin/rounds/pending" element={<AdminPendingQueuePage />} />
            <Route path="/admin/rounds/:id" element={<AdminRoundReviewPage />} />
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
