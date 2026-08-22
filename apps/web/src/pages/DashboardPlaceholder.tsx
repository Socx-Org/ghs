import { useAuth } from "../hooks/useAuth";

// ghs#64: a real, working post-login destination, but not a real
// screen -- Player Dashboard is its own later issue (ghs#65). This
// exists so RequireAuth has somewhere genuine to send an authenticated
// user.
//
// ghs#96: no header/logo/Admin-nav/sign-out here any more -- AppShell's
// Sidebar and AccountMenu now provide all of that uniformly (the
// Sidebar's own Admin -> Accounts entry already covers what this
// page's NavItem used to; ghs#142 later removed the Sidebar's separate
// Create Account entry once AdminAccountsPage grew its own button to
// the same route).
export default function DashboardPlaceholder() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <p className="text-text">
        Signed in as <strong>{user?.email}</strong> ({user?.role})
      </p>
      <p className="text-sm text-text-muted">Product screens land in later issues -- see ghs#65 onward.</p>
    </div>
  );
}
