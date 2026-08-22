import { Badge } from "../Badge";
import { ACCOUNT_STATUS_CONFIG } from "../../lib/domain-labels";
import type { UserStatus } from "../../types/domain";

export interface AccountStatusBadgeProps {
  status: UserStatus;
  className?: string;
}

// ghs#104. GHS-specific mapping lives in lib/domain-labels.ts, not here
// or in Badge -- same pattern as RoleBadge/RoundStatusBadge (ghs#137
// review fix -- see that file's own doc comment for why).
export function AccountStatusBadge({ status, className }: AccountStatusBadgeProps) {
  const config = ACCOUNT_STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
