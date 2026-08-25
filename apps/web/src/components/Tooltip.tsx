import { cloneElement, useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { cn } from "../lib/cn";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  // Plain text only (ghs#166's own non-scope) -- a tooltip with links or
  // buttons inside it raises its own focus-management questions this
  // issue doesn't take on.
  content: string;
  // A single element -- typically a Button. Cloned only to attach
  // aria-describedby; every hover/focus/touch listener lives on the
  // wrapping span instead (focus/blur bubble from a focusable descendant
  // even though the span itself isn't focusable), so the child's own
  // props are never overwritten.
  children: ReactElement;
  placement?: TooltipPlacement;
}

const PLACEMENT_CLASSES: Record<TooltipPlacement, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

// A brief hover-intent delay (avoids a flash of tooltip while the mouse
// just passes over a button on its way elsewhere) -- but zero delay for
// focus/touch, where showing immediately is the correct, expected
// behaviour, not a debounced one.
const HOVER_SHOW_DELAY_MS = 400;
// ghs#166: touch has no hover/focus equivalent, so a tap shows the
// tooltip AND still lets the button's own onClick fire normally --
// never consumes the tap just to preview the label, which would turn
// every icon-only action into a two-tap interaction. Auto-hides shortly
// after so it doesn't linger indefinitely on a device with no "mouse
// leave" to dismiss it.
const TOUCH_AUTO_HIDE_MS = 1600;

// ghs#166: reverses frontend-architecture.md's earlier "Deferred:
// Tooltip" decision, which excluded tooltips specifically because
// hover-only interactions don't work on touch. Addressed here, not
// ignored: shown on keyboard focus and on touch tap, not just mouse
// hover, and touch never blocks the button's real action to do it.
//
// role="tooltip" + aria-describedby (WAI-ARIA APG tooltip pattern), but
// only when `content` differs from the child's own aria-label --
// mirroring an icon-only button's aria-label back as aria-describedby
// would have a screen reader announce the identical text twice.
export function Tooltip({ content, children, placement = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  function clearTimers() {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  }

  function show(delayMs: number) {
    clearTimers();
    if (delayMs === 0) {
      setVisible(true);
    } else {
      showTimer.current = setTimeout(() => setVisible(true), delayMs);
    }
  }

  function hide() {
    clearTimers();
    setVisible(false);
  }

  function handleTouchStart() {
    show(0);
    hideTimer.current = setTimeout(() => setVisible(false), TOUCH_AUTO_HIDE_MS);
  }

  useEffect(() => {
    if (!visible) return;
    // Same click-outside convention as AccountMenu -- a mousedown
    // listener checking containerRef.current.contains(), not a
    // second, parallel mechanism.
    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        hide();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => clearTimers, []);

  // Review fix: the child may already carry its own aria-describedby
  // (e.g. a Button linked to real form error/help text) -- appending
  // this tooltip's id to that, not replacing it, so cloneElement below
  // never silently severs an existing accessibility link. Left
  // untouched (not stripped) whenever the tooltip doesn't need it
  // (hidden, or its content just mirrors the child's own aria-label).
  const childProps = children.props as { "aria-label"?: string; "aria-describedby"?: string };
  const existingDescribedBy = childProps["aria-describedby"];
  const shouldDescribe = visible && content !== childProps["aria-label"];
  const describedBy = shouldDescribe ? [existingDescribedBy, tooltipId].filter(Boolean).join(" ") : existingDescribedBy;

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={() => show(HOVER_SHOW_DELAY_MS)}
      onMouseLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      onTouchStart={handleTouchStart}
    >
      {cloneElement(children, { "aria-describedby": describedBy } as Record<string, unknown>)}
      {visible && (
        <span
          role="tooltip"
          id={tooltipId}
          className={cn(
            "pointer-events-none absolute z-50 max-w-xs whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-text",
            // Liquid glass: a blurred, translucent panel (never opaque)
            // that frosts whatever is behind it, a soft light-sheen
            // gradient layered over the base tint for a sense of
            // refraction, and an inset top highlight standing in for a
            // sharp glass edge. Distinct light/dark values, not one
            // fixed dark panel -- --surface itself is already
            // theme-aware (white in light, slate-800 in dark), so its
            // low-opacity form stays theme-correct automatically; only
            // the highlight/border opacities are tuned per theme, since
            // a light-mode edge highlight this bright would be
            // invisible in dark mode and vice versa.
            "backdrop-blur-md backdrop-saturate-150",
            "bg-surface/70 dark:bg-surface/55",
            "bg-gradient-to-b from-white/20 to-transparent dark:from-white/5",
            "border border-white/40 dark:border-white/10",
            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),0_8px_24px_-4px_rgba(0,0,0,0.25)]",
            "dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_8px_24px_-4px_rgba(0,0,0,0.5)]",
            PLACEMENT_CLASSES[placement],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
