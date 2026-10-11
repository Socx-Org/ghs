import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionStatusBadge } from "./SessionStatusBadge";
import type { LoginSessionStatus } from "../../types/domain";

afterEach(() => {
  cleanup();
});

const CASES: Array<{ status: LoginSessionStatus; label: string }> = [
  { status: "active", label: "Active" },
  { status: "expired", label: "Expired" },
  { status: "logged_out", label: "Logged out" },
];

describe("SessionStatusBadge", () => {
  it.each(CASES)("renders the correct label for status=$status", ({ status, label }) => {
    render(<SessionStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
