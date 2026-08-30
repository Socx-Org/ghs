import { useState } from "react";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { Button } from "./Button";
import { Footer } from "./Footer";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Tooltip } from "./Tooltip";
import { AccountMenu } from "./navigation/AccountMenu";
import { MobileNav } from "./navigation/MobileNav";
import { Sidebar } from "./navigation/Sidebar";
import { useHeartbeat } from "../hooks/useHeartbeat";

export interface AppShellProps {
  // ghs#102: optional so a non-route consumer (the authenticated branch
  // of NotFoundRoute, AppRoutes.tsx) can wrap a specific page directly
  // without a router <Outlet/> -- every route-driven usage still omits
  // this and gets the default Outlet behaviour unchanged.
  children?: ReactNode;
}

// ghs#96: the real application shell (design doc section 7) -- applied
// once, at the route level (AppRoutes.tsx wraps every authenticated
// route in this), not per-page. Individual pages stop rendering their
// own header/logo/sign-out and become pure content inside <Outlet/>.
//
// h-screen + flex-col on the outer wrapper, with `main` as the only
// `flex-1 overflow-y-auto` -- header and footer stay `shrink-0` and
// visually stable; the page scrolls independently between them,
// per the design doc's own literal CSS sketch.
export default function AppShell({ children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // ghs#179: the one place every authenticated route mounts through, so
  // the natural home for this page-independent global behaviour.
  useHeartbeat();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            {/* ghs#166: placement="bottom" -- this button sits in the top
                header bar, where the default "top" placement would render
                the tooltip off-screen above the viewport. */}
            <Tooltip content="Open navigation" placement="bottom">
              <Button variant="ghost" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
                <Menu aria-hidden="true" className="h-5 w-5" />
              </Button>
            </Tooltip>
            <Logo variant="mark" label="GHS" />
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-bg-page">
          {children ?? <Outlet />}
        </main>

        <Footer />
      </div>
    </div>
  );
}
