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
// ThemeToggle depends on it to track prefers-color-scheme. This is a
// real, working EventTarget-based MediaQueryList (not just a
// matches:false stub), so a test can flip `.matches` and dispatch a
// real "change" event to exercise ThemeToggle's system-preference
// listener -- ghs#82's ThemeToggle.test.tsx does exactly that.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => {
    const target = new EventTarget();
    const mql = {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      addListener: target.addEventListener.bind(target),
      removeListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    } as unknown as MediaQueryList;
    return mql;
  };
}
