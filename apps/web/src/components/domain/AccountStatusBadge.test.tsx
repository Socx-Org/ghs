import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountStatusBadge } from "./AccountStatusBadge";
import type { UserStatus } from "../../types/domain";

afterEach(() => {
  cleanup();
});

const CASES: Array<{ status: UserStatus; label: string }> = [
  { status: "pending_verification", label: "Pending" },
  { status: "active", label: "Active" },
  { status: "disabled", label: "Disabled" },
  { status: "deleted", label: "Deleted" },
];

describe("AccountStatusBadge", () => {
  it.each(CASES)("renders the correct label for status=$status", ({ status, label }) => {
    render(<AccountStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
