import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RoundStatusBadge } from "./RoundStatusBadge";
import type { RoundStatus } from "../../types/domain";

afterEach(() => {
  cleanup();
});

const CASES: Array<{ status: RoundStatus; label: string }> = [
  { status: "draft", label: "Draft" },
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
  { status: "amending", label: "Amending" },
];

describe("RoundStatusBadge", () => {
  it.each(CASES)("renders the correct label for status=$status", ({ status, label }) => {
    render(<RoundStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("gives amending a visually distinct treatment from pending", () => {
    const { container: pendingContainer } = render(<RoundStatusBadge status="pending" />);
    const { container: amendingContainer } = render(<RoundStatusBadge status="amending" />);
    const pendingClass = pendingContainer.querySelector("span")?.className;
    const amendingClass = amendingContainer.querySelector("span")?.className;
    expect(pendingClass).not.toEqual(amendingClass);
  });
});
