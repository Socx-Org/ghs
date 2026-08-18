import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "./ThemeToggle";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function setSystemPrefersDark(matches: boolean) {
  // The dispatched "change" event drives a React state update
  // (ThemeToggle's own matchMedia listener calling setThemeState)
  // outside of a DOM event React itself dispatched, so it needs an
  // explicit act() to flush synchronously before the next assertion --
  // without it, the DOM query below can run before React re-renders.
  act(() => {
    (window as unknown as { __setMediaQueryMatches: (query: string, matches: boolean) => void }).__setMediaQueryMatches(
      DARK_QUERY,
      matches,
    );
  });
}

afterEach(() => {
  cleanup();
  localStorage.removeItem("ghs-theme");
  document.documentElement.removeAttribute("data-theme");
  // The matchMedia polyfill caches one MediaQueryList per query string
  // at module scope (test-setup.ts) so a test and the component under
  // test share the same instance -- that cache outlives any single
  // test, so reset .matches back to the default between tests or a
  // later test could observe a previous test's simulated preference.
  setSystemPrefersDark(false);
});

describe("ThemeToggle", () => {
  it("renders with an accessible name describing the switch target", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });

  it("does not write to localStorage or set data-theme merely by mounting", () => {
    render(<ThemeToggle />);
    expect(localStorage.getItem("ghs-theme")).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("locks in an explicit choice on click -- sets data-theme and persists it", async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("ghs-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("toggles back on a second click", async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    await userEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("ghs-theme")).toBe("light");
  });

  it("reflects an already-stored preference on mount", () => {
    localStorage.setItem("ghs-theme", "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("tracks a live system-preference change when no explicit choice has been made", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();

    setSystemPrefersDark(true);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();

    setSystemPrefersDark(false);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });

  it("ignores further system-preference changes once an explicit choice has been made", async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();

    // The user explicitly chose dark; the system "switching to light"
    // afterwards must not override that choice.
    setSystemPrefersDark(false);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });
});
