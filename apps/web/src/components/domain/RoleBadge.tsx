import { Badge } from "../Badge";
import type { BadgeVariant } from "../Badge";
import type { UserRole } from "../../types/domain";

const ROLE_CONFIG: Record<UserRole, { label: string; variant: BadgeVariant }> = {
  player: { label: "Player", variant: "neutral" },
  admin: { label: "Admin", variant: "neutral" },
  // Distinguished from player/admin -- an elevated, sensitive permission
  // worth a small visual flag, without competing with round-status colours.
  super_admin: { label: "Super Admin", variant: "info" },
};

export interface RoleBadgeProps {
  role: UserRole;
  className?: string;
}

// GHS-specific mapping lives here, not in Badge. Role is identity
// metadata, not an alert/status signal -- deliberately neutral rather
// than using success/warning/danger, which are reserved for round status.
export function RoleBadge({ role, className }: RoleBadgeProps) {
  const config = ROLE_CONFIG[role];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
