import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

type Theme = "light" | "dark";

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem("ghs-theme");
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Merely mounting this (or loading the catalogue with system dark mode
// active) must not silently "lock in" that preference -- only an actual
// click should write to localStorage/data-theme. Until that happens,
// the displayed theme tracks live system-preference changes; once the
// user has chosen explicitly, further system changes are ignored (the
// explicit choice wins, per the approved theme strategy).
function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());
  const hasExplicitChoice = useRef(getStoredTheme() !== null);

  useEffect(() => {
    // Checking the ref only here, at subscribe time, isn't enough --
    // this effect runs once on mount, so a listener registered while
    // there was no explicit choice yet would stay subscribed and keep
    // firing even after setTheme() flips the ref to true later
    // (discovered via a real test: toggling explicitly, then simulating
    // a system-preference change, silently reverted the explicit
    // choice). The handler itself has to re-check the ref on every
    // firing, not just once at registration.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (hasExplicitChoice.current) return;
      setThemeState(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    hasExplicitChoice.current = true;
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("ghs-theme", next);
    } catch {
      /* localStorage unavailable -- theme still applies for this session via the attribute. */
    }
    setThemeState(next);
  }, []);

  return [theme, setTheme] as const;
}

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  // ghs#166: content mirrors the button's own aria-label -- single
  // source of truth, not a second copy that can drift. placement="bottom"
  // -- this button lives in the top header bar, where the default "top"
  // placement would render the tooltip off-screen above the viewport.
  const label = `Switch to ${next} theme`;

  return (
    <Tooltip content={label} placement="bottom">
      <Button variant="ghost" aria-label={label} onClick={() => setTheme(next)} className={className}>
        {theme === "dark" ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
      </Button>
    </Tooltip>
  );
}
