import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LoginOutcomeBadge } from "./LoginOutcomeBadge";
import type { LoginAttemptOutcome } from "../../types/domain";

afterEach(() => {
  cleanup();
});

const CASES: Array<{ outcome: LoginAttemptOutcome; label: string }> = [
  { outcome: "success", label: "Success" },
  { outcome: "invalid_credentials", label: "Invalid credentials" },
  { outcome: "account_not_active", label: "Account not active" },
  { outcome: "mfa_required", label: "MFA required" },
  { outcome: "invalid_mfa_code", label: "Invalid MFA code" },
];

describe("LoginOutcomeBadge", () => {
  it.each(CASES)("renders the correct label for outcome=$outcome", ({ outcome, label }) => {
    render(<LoginOutcomeBadge outcome={outcome} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
