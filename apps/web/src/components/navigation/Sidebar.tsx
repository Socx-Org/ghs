import { NavLink } from "react-router-dom";
import { Logo } from "../Logo";
import { navItemClasses, useNavEntries } from "./nav-entries";

// Persistent left navigation, desktop only (lg:) -- MobileNav is the
// same entries, presented as a drawer, below that breakpoint. One
// responsive shell, two presentations of the same data, not two
// independently-maintained navigation structures.
export function Sidebar() {
  const entries = useNavEntries();

  return (
    <aside className="hidden shrink-0 border-r border-border bg-surface lg:flex lg:w-64 lg:flex-col">
      <div className="flex h-16 shrink-0 items-center px-6">
        <Logo label="GHS" />
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3 py-4">
        {entries.map((entry) => (
          <NavLink key={entry.to} to={entry.to} end={entry.to === "/"} className={({ isActive }) => navItemClasses(isActive)}>
            <entry.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
            {entry.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
