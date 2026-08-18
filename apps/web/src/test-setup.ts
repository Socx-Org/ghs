import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement <dialog>'s showModal()/close() (documented jsdom
// gap, not a bug in Modal.tsx -- confirmed directly: showModal is simply
// absent from HTMLDialogElement.prototype under jsdom). This polyfill lets
// component tests exercise Modal's own open/close wiring; it deliberately
// does NOT attempt to replicate real focus-trap, inert-background, or
// Escape-key dispatch -- those are verified against a real browser instead
// (see ghs#78's verification notes), not asserted here.
// Guarded on HTMLDialogElement existing at all -- this file is a global
// Vitest setupFile, loaded regardless of which environment a given test
// file requests. A test file opting into `// @vitest-environment node`
// would otherwise throw a ReferenceError here before any test in the
// suite runs, unrelated to what that file actually needs (review
// finding, PR #79).
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}

// jsdom doesn't implement window.matchMedia at all (confirmed directly:
// typeof window.matchMedia is "undefined" under jsdom, not just a stub).
// ThemeToggle depends on it to track prefers-color-scheme.
//
// Three real bugs in an earlier version of this polyfill, found in
// review (PR #83) and fixed here:
//  1. addListener/removeListener (the legacy MediaQueryList API) were
//     bound directly to addEventListener/removeEventListener, which
//     takes (type, listener) -- addListener takes just (listener). A
//     caller using the legacy API would have registered "the callback"
//     itself as an event *type*.
//  2. Returned a brand new object on every call. A test calling
//     window.matchMedia(query) to simulate an OS preference change
//     would get a *different* instance than the one a component's own
//     matchMedia(query) call had already subscribed to -- dispatching
//     on it would reach no one. Now cached per query string.
//  3. A plain `new Event("change")` has no .matches property, unlike a
//     real MediaQueryListEvent -- ThemeToggle's handler reads
//     `e.matches` directly, so a dispatched event needs to actually
//     carry it, not just fire.
if (typeof window !== "undefined" && !window.matchMedia) {
  const mediaQueryListCache = new Map<string, MediaQueryList>();

  window.matchMedia = (query: string): MediaQueryList => {
    const cached = mediaQueryListCache.get(query);
    if (cached) return cached;

    const target = new EventTarget();
    const mql = {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      addListener(callback: ((event: MediaQueryListEvent) => void) | null) {
        if (callback) target.addEventListener("change", callback as EventListener);
      },
      removeListener(callback: ((event: MediaQueryListEvent) => void) | null) {
        if (callback) target.removeEventListener("change", callback as EventListener);
      },
      dispatchEvent: target.dispatchEvent.bind(target),
    } as unknown as MediaQueryList;

    mediaQueryListCache.set(query, mql);
    return mql;
  };

  // Test-only helper: simulates a real OS-level media-query change
  // (e.g. prefers-color-scheme flipping) against the *same* cached
  // instance a component already subscribed to, dispatching an event
  // that actually carries .matches -- see bugs 2 and 3 above.
  // ThemeToggle.test.tsx uses this to verify live system-preference
  // tracking, not just mount-time state and click behaviour.
  (window as unknown as { __setMediaQueryMatches: (query: string, matches: boolean) => void }).__setMediaQueryMatches = (
    query: string,
    matches: boolean,
  ) => {
    const mql = window.matchMedia(query);
    (mql as { matches: boolean }).matches = matches;
    const event = new Event("change");
    Object.defineProperty(event, "matches", { value: matches, configurable: true });
    mql.dispatchEvent(event);
  };
}
