import { Link, useLocation } from "react-router-dom";
import { Logo } from "../Logo";
import { isNavEntryActive, navItemClasses, useNavEntries } from "./nav-entries";

// Persistent left navigation, desktop only (lg:) -- MobileNav is the
// same entries, presented as a drawer, below that breakpoint. One
// responsive shell, two presentations of the same data, not two
// independently-maintained navigation structures.
export function Sidebar() {
  const entries = useNavEntries();
  const { pathname } = useLocation();

  return (
    <aside className="hidden shrink-0 border-r border-border bg-surface lg:flex lg:w-64 lg:flex-col">
      <div className="flex h-16 shrink-0 items-center px-6">
        <Logo label="GHS" />
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3 py-4">
        {entries.map((entry) => {
          // ghs#211: computed ourselves (isNavEntryActive), not NavLink's
          // own built-in prefix matching -- see that helper's own doc
          // comment for why a plain prefix test marks the wrong entry
          // active for sibling routes like /admin/rounds/pending vs.
          // /admin/rounds. Link, not NavLink, since we're no longer
          // using its isActive/aria-current wiring at all.
          const isActive = isNavEntryActive(entry, entries, pathname);
          return (
            <Link key={entry.to} to={entry.to} aria-current={isActive ? "page" : undefined} className={navItemClasses(isActive)}>
              <entry.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
              {entry.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
