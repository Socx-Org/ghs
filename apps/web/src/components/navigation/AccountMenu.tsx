import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut, UserCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

function roleLabel(role: string): string {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "Player";
}

// ghs#96: a real accessible disclosure popover (design doc section 7's
// own requirement, "do not use hover-only menus") -- not a headless-UI
// dependency, since a click-outside + Escape listener is the entire
// mechanism needed here and this is the only dropdown the app has today
// (design principle 9: no generic Menu abstraction for a single real
// consumer). Deliberately NOT role="menu"/role="menuitem": the panel
// mixes static text (email/role) with a single action, which is an ARIA
// menu-pattern mismatch (menus expect every child to be a menuitem with
// roving-tabindex arrow-key navigation) -- a plain disclosure with
// aria-expanded/aria-controls and normal tab order is the correct,
// simpler pattern for this content (caught in PR review, ghs#97).
export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate("/login", { replace: true });
  }

  if (!user) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // A stable accessible name independent of the signed-in user's
        // email -- "open the account menu" is this button's actual
        // purpose; the email is supplementary visual/contextual info,
        // still reachable once the panel itself is open.
        aria-label="Account menu"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-text hover:bg-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
      >
        <UserCircle aria-hidden="true" className="h-6 w-6" />
        <span className="hidden max-w-[10rem] truncate sm:inline">{user.email}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4" />
      </button>

      {open && (
        <div id={panelId} className="absolute right-0 z-20 mt-2 w-64 rounded-md border border-border bg-surface p-2 shadow-lg">
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium text-text">{user.email}</p>
            <p className="text-xs text-text-muted">{roleLabel(user.role)}</p>
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-sm text-text hover:bg-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
