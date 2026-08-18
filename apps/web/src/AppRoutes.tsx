import { Navigate, Route, Routes } from "react-router-dom";
import ComponentsCatalogue from "./ComponentsCatalogue";
import AdminCreateUserPage from "./pages/AdminCreateUserPage";
import DashboardPlaceholder from "./pages/DashboardPlaceholder";
import LoginPage from "./pages/LoginPage";
import { RedirectIfAuthenticated } from "./routes/RedirectIfAuthenticated";
import { RequireAdmin } from "./routes/RequireAdmin";
import { RequireAuth } from "./routes/RequireAuth";

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
        <Route path="/" element={<DashboardPlaceholder />} />
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
