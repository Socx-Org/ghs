import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import App from "./App.tsx";

// ghs#62: proves the real test pipeline (Vitest + React Testing Library +
// jsdom) end-to-end, not a throwaway assertion -- renders the actual
// placeholder component and asserts on its real async state transition.
describe("App", () => {
  afterEach(() => {
    // Explicit, not relying on RTL's own auto-cleanup -- this project's
    // vitest config runs with globals: false (explicit imports
    // throughout, matching apps/api's own node:test discipline), and
    // RTL's auto-cleanup registration depends on detecting a global
    // test framework. Found for real: without this, the previous
    // test's rendered tree was still mounted when this one asserted,
    // producing two matching elements instead of one.
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the placeholder and reflects a successful health check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    render(<App />);

    expect(screen.getByRole("heading", { name: "GHS" })).toBeInTheDocument();
    expect(screen.getByTestId("api-status")).toHaveTextContent("API: checking");

    await waitFor(() => expect(screen.getByTestId("api-status")).toHaveTextContent("API: ok"));
  });

  it("reflects a failed health check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("api-status")).toHaveTextContent("API: error"));
  });
});
