import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "./Footer";

afterEach(() => {
  cleanup();
});

describe("Footer", () => {
  it("shows the current year and copyright", () => {
    render(<Footer />);
    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
    expect(screen.getByText(/Socx Organisation/)).toBeInTheDocument();
  });

  it("shows the environment tier (import.meta.env.MODE)", () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(import.meta.env.MODE))).toBeInTheDocument();
  });

  it("is a real <footer> landmark", () => {
    render(<Footer />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
