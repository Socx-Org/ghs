import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./Button";

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
    if (hasExplicitChoice.current) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setThemeState(e.matches ? "dark" : "light");
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

  return (
    <Button
      variant="ghost"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className={className}
    >
      {theme === "dark" ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
    </Button>
  );
}
