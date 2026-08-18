import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

// Built on native <dialog> deliberately, not a headless-UI dependency
// (Radix/Headless UI) -- showModal() gives focus-trap, Escape-to-close,
// inert background, and focus-restore-on-close for free in every
// evergreen browser, which was the entire justification for reaching for
// a dependency here. See frontend-architecture.md.
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Native dialog.close() fires "close" the same as Escape/backdrop
  // dismissal does. Without this flag, a parent that flips `open` to
  // false itself (its own state update, not one of Modal's own dismiss
  // paths) would cause onClose() to fire a second time for the same
  // transition once the resulting dialog.close() below echoes back
  // through the "close" listener -- a real duplicate-side-effect risk
  // for consumers with more than a boolean toggle in onClose (review
  // finding, PR #79). Set right before the parent-driven close() call,
  // consumed by the very close event that call produces.
  const closingProgrammaticallyRef = useRef(false);
  const titleId = useId();

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
    // "close" fires however the dialog closed -- Escape, our own close
    // button, a backdrop click below, or the parent-driven path above --
    // so this is the single source of truth for syncing back to the
    // parent's `open` state, rather than handling each dismissal path
    // separately. The parent-driven case is suppressed (see the ref
    // above) since the parent already knows.
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
      aria-labelledby={titleId}
      onClick={(event) => {
        // A click on the ::backdrop lands on the <dialog> element itself
        // (not a descendant), since the visible content is an inset
        // child box -- this is how native <dialog> distinguishes
        // backdrop clicks from content clicks without extra markup.
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      className={cn(
        "m-0 w-full max-w-lg rounded-t-lg border border-border bg-surface p-0 shadow-xl backdrop:bg-slate-900/50",
        // top-auto is required, not decorative -- Chromium's UA stylesheet
        // sets `inset: 0` on dialog:modal, so without an explicit
        // override here `top` stays 0 and, combined with bottom-0 and
        // height:auto, the box anchors to the *top* of the viewport
        // instead of the bottom (found by real browser verification,
        // not assumed from the class list alone).
        "fixed inset-x-0 top-auto bottom-0 max-h-[85vh]",
        "sm:inset-0 sm:m-auto sm:max-h-[calc(100vh-4rem)] sm:rounded-lg",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <h2 id={titleId} className="text-lg font-semibold text-text">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
          className="rounded-md p-2 text-text-muted hover:bg-text/5 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-3 sm:px-6">{footer}</div>}
    </dialog>
  );
}
