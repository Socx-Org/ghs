import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Alert } from "./Alert";

afterEach(() => {
  cleanup();
});

describe("Alert", () => {
  it("uses role=alert for urgent variants (error, warning)", () => {
    render(<Alert variant="error">Failed to save.</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to save.");
  });

  it("uses role=status for non-urgent variants (success, info)", () => {
    render(<Alert variant="success">Round saved.</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Round saved.");
  });

  it("announces the variant textually, not by colour alone", () => {
    render(<Alert variant="warning">Session expiring soon.</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Warning:");
  });
});
