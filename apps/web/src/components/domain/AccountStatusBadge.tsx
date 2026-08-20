import { Badge } from "../Badge";
import type { BadgeVariant } from "../Badge";
import type { UserStatus } from "../../types/domain";

const STATUS_CONFIG: Record<UserStatus, { label: string; variant: BadgeVariant }> = {
  pending_verification: { label: "Pending", variant: "warning" },
  active: { label: "Active", variant: "success" },
  // neutral, not danger -- an intentional administrative pause, not a
  // failure state (same reasoning as RoundStatusBadge's "draft").
  disabled: { label: "Disabled", variant: "neutral" },
  deleted: { label: "Deleted", variant: "danger" },
};

export interface AccountStatusBadgeProps {
  status: UserStatus;
  className?: string;
}

// ghs#104. GHS-specific mapping lives here, not in Badge -- same
// pattern as RoleBadge/RoundStatusBadge.
export function AccountStatusBadge({ status, className }: AccountStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
