import { useNavigate } from "react-router-dom";
import { Button, Logo } from "../components";
import { useAuth } from "../hooks/useAuth";

// ghs#64: a real, working post-login destination, but not a real
// screen -- Player Dashboard is its own later issue (ghs#65). This
// exists so RequireAuth has somewhere genuine to send an authenticated
// user, and so logout is exercised by something real rather than left
// untested until #65 lands.
export default function DashboardPlaceholder() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-page p-4 text-center">
      <Logo />
      <p className="text-text">
        Signed in as <strong>{user?.email}</strong> ({user?.role})
      </p>
      <p className="text-sm text-text-muted">Product screens land in later issues -- see ghs#65 onward.</p>
      <Button variant="secondary" onClick={handleLogout}>
        Sign out
      </Button>
    </div>
  );
}
