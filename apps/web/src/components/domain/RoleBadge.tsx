import { Badge } from "../Badge";
import { ROLE_CONFIG } from "../../lib/domain-labels";
import type { UserRole } from "../../types/domain";

export interface RoleBadgeProps {
  role: UserRole;
  className?: string;
}

// GHS-specific mapping lives in lib/domain-labels.ts, not here or in
// Badge (ghs#137 review fix -- see that file's own doc comment for
// why). Role is identity metadata, not an alert/status signal --
// deliberately neutral rather than using success/warning/danger, which
// are reserved for round status.
export function RoleBadge({ role, className }: RoleBadgeProps) {
  const config = ROLE_CONFIG[role];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
