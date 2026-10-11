import { Badge } from "../Badge";
import { SESSION_STATUS_CONFIG } from "../../lib/domain-labels";
import type { LoginSessionStatus } from "../../types/domain";

export interface SessionStatusBadgeProps {
  status: LoginSessionStatus;
  className?: string;
}

// ghs#233. Only ever rendered for a 'success' login attempt -- the
// caller renders "--" itself for every other outcome (see
// AdminLoginAttemptsPage), rather than this component having to accept
// `status: LoginSessionStatus | null` and re-decide that here too.
export function SessionStatusBadge({ status, className }: SessionStatusBadgeProps) {
  const config = SESSION_STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
