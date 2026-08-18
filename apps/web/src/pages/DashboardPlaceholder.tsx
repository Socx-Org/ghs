import { ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppHeader, Button, Logo, NavItem } from "../components";
import { useAuth } from "../hooks/useAuth";

// ghs#64: a real, working post-login destination, but not a real
// screen -- Player Dashboard is its own later issue (ghs#65). This
// exists so RequireAuth has somewhere genuine to send an authenticated
// user, and so logout is exercised by something real rather than left
// untested until #65 lands.
export default function DashboardPlaceholder() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg-page">
      <AppHeader
        brand={<Logo variant="mark" label="GHS" />}
        nav={
          isAdmin && (
            <NavItem icon={<ShieldCheck className="h-4 w-4" />} href="/admin/users/new">
              Admin
            </NavItem>
          )
        }
        actions={
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        }
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-text">
          Signed in as <strong>{user?.email}</strong> ({user?.role})
        </p>
        <p className="text-sm text-text-muted">Product screens land in later issues -- see ghs#65 onward.</p>
      </div>
    </div>
  );
}
