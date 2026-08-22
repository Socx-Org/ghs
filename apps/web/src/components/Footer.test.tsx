import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "./Footer";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("Footer", () => {
  it("shows the current year and 'All rights reserved'", () => {
    render(<Footer />);
    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
    expect(screen.getByText(/Socx Organisation\. All rights reserved\./)).toBeInTheDocument();
  });

  // ghs#133: the environment tag is dev/test-only -- a real production
  // visitor seeing "· production" isn't useful to them.
  it("shows the environment tier (import.meta.env.MODE) when not in production", () => {
    vi.stubEnv("MODE", "development");
    render(<Footer />);
    expect(screen.getByText(/development/)).toBeInTheDocument();
  });

  it("hides the environment tier entirely in production", () => {
    vi.stubEnv("MODE", "production");
    render(<Footer />);
    expect(screen.queryByText(/production/)).not.toBeInTheDocument();
  });

  it("is a real <footer> landmark", () => {
    render(<Footer />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
