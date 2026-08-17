import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement <dialog>'s showModal()/close() (documented jsdom
// gap, not a bug in Modal.tsx -- confirmed directly: showModal is simply
// absent from HTMLDialogElement.prototype under jsdom). This polyfill lets
// component tests exercise Modal's own open/close wiring; it deliberately
// does NOT attempt to replicate real focus-trap, inert-background, or
// Escape-key dispatch -- those are verified against a real browser instead
// (see ghs#78's verification notes), not asserted here.
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
