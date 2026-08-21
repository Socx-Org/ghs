import { Flag, LandPlot, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import type { ComponentType } from "react";
import { useAuth } from "../../hooks/useAuth";
import { cn } from "../../lib/cn";

// ghs#96: nav items reflect only routes that actually exist today --
// no speculative items (design doc's own principle 9). Shared between
// the desktop Sidebar and MobileNav so the two never drift. Kept out
// of Sidebar.tsx/MobileNav.tsx themselves -- a file exporting both a
// component and plain functions/hooks breaks Fast Refresh
// (react-refresh/only-export-components), same reasoning as
// lib/dates.ts's playedAtToIsoString extraction (PR #95).
export interface NavEntry {
  to: string;
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
}

export function useNavEntries(): NavEntry[] {
  const { user } = useAuth();
  const entries: NavEntry[] = [{ to: "/", label: "Dashboard", icon: LayoutDashboard }];
  // ghs#109: GET /courses has no role restriction on the backend, and
  // this issue's own scope says the same on the frontend -- every
  // authenticated role gets this entry, unlike Accounts/Create Account
  // below.
  entries.push({ to: "/courses", label: "Courses", icon: LandPlot });
  if (user?.role === "player") {
    entries.push({ to: "/rounds/new", label: "New Round", icon: Flag });
  }
  if (user?.role === "admin" || user?.role === "super_admin") {
    entries.push({ to: "/admin/users", label: "Accounts", icon: Users });
    entries.push({ to: "/admin/users/new", label: "Create Account", icon: ShieldCheck });
  }
  return entries;
}

// Soft accent, not a filled background, for the active item -- the
// design doc's own instruction ("use the emerald brand colour as an
// accent... do not overuse emerald backgrounds"), and the exact
// treatment AppHeader's own NavItem already uses for visual
// consistency across the app.
export function navItemClasses(isActive: boolean): string {
  return cn(
    "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
    isActive ? "bg-primary-soft text-primary" : "text-text-muted hover:bg-text/5 hover:text-text",
  );
}
