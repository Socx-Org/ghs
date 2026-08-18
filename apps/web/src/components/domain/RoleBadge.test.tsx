import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RoleBadge } from "./RoleBadge";
import type { UserRole } from "../../types/domain";

afterEach(() => {
  cleanup();
});

const CASES: Array<{ role: UserRole; label: string }> = [
  { role: "player", label: "Player" },
  { role: "admin", label: "Admin" },
  { role: "super_admin", label: "Super Admin" },
];

describe("RoleBadge", () => {
  it.each(CASES)("renders the correct label for role=$role", ({ role, label }) => {
    render(<RoleBadge role={role} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
