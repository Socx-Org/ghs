import { Badge } from "../Badge";
import { LOGIN_OUTCOME_CONFIG } from "../../lib/domain-labels";
import type { LoginAttemptOutcome } from "../../types/domain";

export interface LoginOutcomeBadgeProps {
  outcome: LoginAttemptOutcome;
  className?: string;
}

// ghs#233. GHS-specific mapping lives in lib/domain-labels.ts, not here
// or in Badge -- same pattern as RoleBadge/AccountStatusBadge (ghs#137
// review fix -- see that file's own doc comment for why).
export function LoginOutcomeBadge({ outcome, className }: LoginOutcomeBadgeProps) {
  const config = LOGIN_OUTCOME_CONFIG[outcome];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
