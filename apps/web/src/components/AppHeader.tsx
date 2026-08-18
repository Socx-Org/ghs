import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface AppHeaderProps {
  title: string;
  nav?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

// One nav element that wraps/scrolls at every width, rather than separate
// desktop-inline and mobile-below implementations of the same links --
// two DOM copies of the same nav would duplicate landmarks for assistive
// tech for no real benefit here.
export function AppHeader({ title, nav, actions, className }: AppHeaderProps) {
  return (
    <header className={cn("border-b border-slate-200 bg-white", className)}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <span className="text-lg font-semibold text-slate-900">{title}</span>
        {nav && (
          <nav aria-label="Primary" className="flex flex-1 gap-4 overflow-x-auto">
            {nav}
          </nav>
        )}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
