import { useState } from "react";

export type ListViewMode = "table" | "grid";

function storageKeyFor(id: string): string {
  return `ghs-list-view:${id}`;
}

function readStored(id: string): ListViewMode | null {
  try {
    const stored = localStorage.getItem(storageKeyFor(id));
    return stored === "table" || stored === "grid" ? stored : null;
  } catch {
    return null;
  }
}

// ghs#103: same persistence shape as ThemeToggle's own `ghs-theme` key
// (lazy useState initializer reads localStorage once, a real choice
// writes it back) -- one real screen's chosen view (e.g. "accounts")
// shouldn't reset to the default every time the user navigates away and
// back, same reasoning as the theme choice itself.
export function useListView(id: string, defaultView: ListViewMode = "table") {
  const [view, setViewState] = useState<ListViewMode>(() => readStored(id) ?? defaultView);

  function setView(next: ListViewMode) {
    setViewState(next);
    try {
      localStorage.setItem(storageKeyFor(id), next);
    } catch {
      /* localStorage unavailable -- view still applies for this session via state. */
    }
  }

  return [view, setView] as const;
}
