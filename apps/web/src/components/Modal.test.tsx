import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";
import type { ModalProps } from "./Modal";

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement <dialog>'s real showModal()/close() semantics
// (see test-setup.ts) -- no native focus-trap, no Escape-to-cancel
// dispatch. These tests cover Modal's own wiring (labelling, the close
// button calling onClose, closed state not exposing a dialog role) under
// that polyfill. Escape-to-close and focus-trap/restore are verified
// against a real browser instead (ghs#78 PR notes), not asserted here --
// asserting them under jsdom would just be testing the polyfill, not Modal.

function renderOpenModal(onClose = vi.fn()) {
  render(
    <Modal open onClose={onClose} title="Reject this round?" footer={<button>Reject</button>}>
      <p>The player will be notified.</p>
    </Modal>,
  );
  return onClose;
}

describe("Modal", () => {
  it("is labelled by its title for assistive tech", () => {
    renderOpenModal();
    expect(screen.getByRole("dialog", { name: "Reject this round?" })).toBeInTheDocument();
  });

  it("calls onClose when the close button is activated", async () => {
    const onClose = renderOpenModal();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders footer content", () => {
    renderOpenModal();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("does not expose a dialog role while closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Reject this round?">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not call onClose a second time when the parent itself sets open=false", () => {
    // Regression test for PR #79's review finding: the parent flipping
    // `open` to false (its own state update, not a click on Modal's own
    // close button) triggers dialog.close() internally, which fires the
    // native "close" event -- onClose must not fire again for that same,
    // already-known transition.
    const onClose = vi.fn();
    function Controlled(props: Partial<ModalProps>) {
      return (
        <Modal open onClose={onClose} title="Reject this round?" {...props}>
          <p>Body</p>
        </Modal>
      );
    }
    const { rerender } = render(<Controlled />);
    rerender(<Controlled open={false} />);
    expect(onClose).not.toHaveBeenCalled();
  });
});
