import { Badge } from "../Badge";
import type { BadgeVariant } from "../Badge";
import type { RoundStatus } from "../../types/domain";

const STATUS_CONFIG: Record<RoundStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "neutral" },
  pending: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  amending: { label: "Amending", variant: "amending" },
};

export interface RoundStatusBadgeProps {
  status: RoundStatus;
  className?: string;
}

// GHS-specific mapping lives here, not in Badge -- see
// apps/web/docs/frontend-architecture.md for why "amending" gets its own
// colour instead of reusing "pending" (different urgency: pending means
// waiting on the committee, amending means waiting on the player).
export function RoundStatusBadge({ status, className }: RoundStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
