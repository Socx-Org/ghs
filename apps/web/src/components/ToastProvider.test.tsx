import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "./ToastProvider";
import { useToast } from "./useToast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function TestHarness() {
  const { show } = useToast();
  return (
    <button onClick={() => show({ variant: "success", message: "Round saved." })}>Trigger</button>
  );
}

describe("ToastProvider / useToast", () => {
  it("throws a clear error when useToast is used outside a ToastProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow("useToast must be used within a ToastProvider");
    spy.mockRestore();
  });

  it("shows a toast with the correct live-region role for its variant", async () => {
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Trigger" }));
    // success -> role=status (polite), matching Alert's own error/warning
    // = alert, success/info = status split.
    expect(screen.getByRole("status")).toHaveTextContent("Round saved.");
  });

  it("dismisses via the close button", async () => {
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-dismisses after the default duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("pausing on hover prevents auto-dismiss until the mouse leaves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    const toast = screen.getByRole("status");

    await user.hover(toast);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // Still present -- paused while hovered, well past the default duration.
    expect(screen.getByRole("status")).toBeInTheDocument();

    await user.unhover(toast);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("clears outstanding auto-dismiss timers on unmount, instead of updating state afterwards", async () => {
    // Regression test for a real gap (review finding, PR #83): without
    // clearing timers on unmount, this scheduled dismiss would still
    // fire after the component tree (and the provider holding it) is
    // gone, calling setState on an unmounted component -- React logs
    // exactly that as a console.error, which is what this asserts
    // never happens.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
