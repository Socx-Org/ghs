import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(() => {
  cleanup();
});

// Module-level, not a prop -- ErrorBoundary re-renders the *same*
// children element on Retry, so a prop-driven "shouldThrow" would still
// be true on the retry render. Flipping this between renders is what
// makes the "Retry recovers" test meaningful rather than trivially true.
let shouldThrow = true;

function Bomb() {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <p>Recovered content</p>;
}

function renderBoundary(initialEntries = ["/", "/somewhere"], initialIndex = 1) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route path="/" element={<p>Home page content</p>} />
        <Route
          path="*"
          element={
            <ErrorBoundary>
              <Bomb />
            </ErrorBoundary>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ErrorBoundary", () => {
  it("catches a render error and shows the fallback instead of crashing the app", () => {
    shouldThrow = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderBoundary();

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("Recovered content")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });

  it("Retry re-renders the same children, recovering once the underlying cause is gone", async () => {
    shouldThrow = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderBoundary();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });

  it("Back navigates through real browser history", async () => {
    shouldThrow = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderBoundary();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Home page content")).toBeInTheDocument();

    errorSpy.mockRestore();
  });

  it("Go to Dashboard navigates to /", async () => {
    shouldThrow = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderBoundary();
    await userEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }));

    expect(screen.getByText("Home page content")).toBeInTheDocument();

    errorSpy.mockRestore();
  });

  it("renders children normally when nothing throws", () => {
    shouldThrow = false;
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });
});
