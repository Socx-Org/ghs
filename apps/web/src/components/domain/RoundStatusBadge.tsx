import { Badge } from "../Badge";
import { ROUND_STATUS_CONFIG } from "../../lib/domain-labels";
import type { RoundStatus } from "../../types/domain";

export interface RoundStatusBadgeProps {
  status: RoundStatus;
  className?: string;
}

// GHS-specific mapping lives in lib/domain-labels.ts, not here or in
// Badge -- see that file's own doc comment for why (ghs#137 review
// fix), and apps/web/docs/frontend-architecture.md for why "amending"
// gets its own colour instead of reusing "pending" (different urgency:
// pending means waiting on the committee, amending means waiting on
// the player).
export function RoundStatusBadge({ status, className }: RoundStatusBadgeProps) {
  const config = ROUND_STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
