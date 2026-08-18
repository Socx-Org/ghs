import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface AppHeaderProps {
  /** Usually a <Logo/>, but left as ReactNode rather than a dedicated
   *  logo prop -- some contexts (e.g. a future admin sub-header) may
   *  reasonably want plain text instead. */
  brand: ReactNode;
  nav?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

// One nav element that wraps/scrolls at every width, rather than separate
// desktop-inline and mobile-below implementations of the same links --
// two DOM copies of the same nav would duplicate landmarks for assistive
// tech for no real benefit here.
export function AppHeader({ brand, nav, actions, className }: AppHeaderProps) {
  return (
    <header className={cn("border-b border-border bg-surface", className)}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        {brand}
        {nav && (
          <nav aria-label="Primary" className="flex flex-1 gap-1 overflow-x-auto">
            {nav}
          </nav>
        )}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface NavItemProps {
  icon?: ReactNode;
  active?: boolean;
  children: ReactNode;
  href?: string;
  onClick?: () => void;
}

// A single reusable nav-item treatment (icon + label + active state),
// not a bespoke per-link className scattered across callers. Renders an
// <a> when href is given, a <button> otherwise -- real navigation should
// be a real link (browser back/forward, open-in-new-tab, etc. all keep
// working), a button is only for a same-page action.
export function NavItem({ icon, active = false, children, href, onClick }: NavItemProps) {
  const classes = cn(
    "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
    active ? "bg-primary-soft text-primary" : "text-text-muted hover:bg-text/5 hover:text-text",
  );
  const content = (
    <>
      {icon && (
        <span aria-hidden="true" className="h-4 w-4">
          {icon}
        </span>
      )}
      {children}
    </>
  );
  if (href) {
    return (
      <a href={href} aria-current={active ? "page" : undefined} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={classes}>
      {content}
    </button>
  );
}
