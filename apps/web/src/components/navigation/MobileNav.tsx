import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Logo } from "../Logo";
import { navItemClasses, useNavEntries } from "./nav-entries";

export interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

// ghs#96: the same nav entries as Sidebar, presented as a real drawer
// on mobile below the lg: breakpoint. Built on native <dialog> the
// same way Modal.tsx is (showModal()/close()'s native focus-trap,
// Escape-to-close, inert background, focus-restore -- the entire
// justification for reaching for <dialog> instead of a headless-UI
// dependency in the first place) -- not reused directly, though, since
// its hardcoded bottom-sheet/centred-dialog positioning is a
// genuinely different shape from a left-edge drawer, not just a
// className override away.
export function MobileNav({ open, onClose }: MobileNavProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Same "who initiated the close" bookkeeping as Modal.tsx, and for
  // the same reason (review finding, PR #79 there): a parent-driven
  // `open -> false` must not double-fire onClose() when the resulting
  // dialog.close() call echoes back through the "close" listener below.
  const closingProgrammaticallyRef = useRef(false);
  const entries = useNavEntries();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingProgrammaticallyRef.current = true;
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      if (closingProgrammaticallyRef.current) {
        closingProgrammaticallyRef.current = false;
        return;
      }
      onClose();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Navigation"
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      className="fixed inset-y-0 left-0 m-0 h-auto w-72 max-w-[85vw] max-h-none border-r border-border bg-surface p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        <Logo label="GHS" />
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => dialogRef.current?.close()}
          className="rounded-md p-2 text-text-muted hover:bg-text/5 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-1 px-3 py-4">
        {entries.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.to === "/"}
            // Closes on selection (design doc section 8's own
            // requirement) -- a real dialog.close(), not just a state
            // flip, so it goes through the exact same "close" handling
            // as Escape/backdrop dismissal above.
            onClick={() => dialogRef.current?.close()}
            className={({ isActive }) => navItemClasses(isActive)}
          >
            <entry.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
            {entry.label}
          </NavLink>
        ))}
      </nav>
    </dialog>
  );
}
