import type { BadgeVariant } from "../components/Badge";
import type { LoginAttemptOutcome, LoginSessionStatus, RoundStatus, UserRole, UserStatus } from "../types/domain";

// ghs#137 review fix: the single source of GHS-specific label (+ badge
// variant) mappings for RoundStatus/UserRole/UserStatus -- previously
// each lived only inside its own badge component
// (RoundStatusBadge/RoleBadge/AccountStatusBadge), which meant a filter
// dropdown needing the same labels (e.g. AdminAccountsPage's Role/Status
// filters, MyRoundsPage's/AdminRoundsListPage's Status filter) had no way
// to reuse them without either redefining the labels a second time (the
// drift risk flagged in review) or a badge component file exporting a
// plain constant alongside its component, which breaks Fast Refresh
// (react-refresh/only-export-components -- same reasoning as
// lib/dates.ts's playedAtToIsoString extraction, PR #95, and
// nav-entries.ts being kept out of Sidebar.tsx/MobileNav.tsx). Each
// badge component now just indexes into its own config here; this file
// exports no components, so Fast Refresh is unaffected by it.

function optionsFrom<K extends string>(config: Record<K, { label: string }>): Array<{ value: K; label: string }> {
  return (Object.keys(config) as K[]).map((key) => ({ value: key, label: config[key].label }));
}

export const ROUND_STATUS_CONFIG: Record<RoundStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "neutral" },
  pending: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  amending: { label: "Amending", variant: "amending" },
};

export const ROUND_STATUS_OPTIONS = optionsFrom(ROUND_STATUS_CONFIG);

export const ROLE_CONFIG: Record<UserRole, { label: string; variant: BadgeVariant }> = {
  player: { label: "Player", variant: "neutral" },
  admin: { label: "Admin", variant: "neutral" },
  // Distinguished from player/admin -- an elevated, sensitive permission
  // worth a small visual flag, without competing with round-status colours.
  super_admin: { label: "Super Admin", variant: "info" },
};

export const ROLE_OPTIONS = optionsFrom(ROLE_CONFIG);

export const ACCOUNT_STATUS_CONFIG: Record<UserStatus, { label: string; variant: BadgeVariant }> = {
  pending_verification: { label: "Pending", variant: "warning" },
  active: { label: "Active", variant: "success" },
  // neutral, not danger -- an intentional administrative pause, not a
  // failure state (same reasoning as RoundStatusBadge's "draft").
  disabled: { label: "Disabled", variant: "neutral" },
  deleted: { label: "Deleted", variant: "danger" },
};

export const ACCOUNT_STATUS_OPTIONS = optionsFrom(ACCOUNT_STATUS_CONFIG);

// ghs#233. success is the only non-alarming outcome; mfa_required is a
// real, in-progress step rather than a failure, kept neutral rather than
// warning/danger for the same reason draft/disabled above aren't either.
export const LOGIN_OUTCOME_CONFIG: Record<LoginAttemptOutcome, { label: string; variant: BadgeVariant }> = {
  success: { label: "Success", variant: "success" },
  invalid_credentials: { label: "Invalid credentials", variant: "danger" },
  account_not_active: { label: "Account not active", variant: "warning" },
  mfa_required: { label: "MFA required", variant: "neutral" },
  invalid_mfa_code: { label: "Invalid MFA code", variant: "danger" },
};

export const LOGIN_OUTCOME_OPTIONS = optionsFrom(LOGIN_OUTCOME_CONFIG);

// ghs#233. Only ever rendered for a 'success' row (see
// LoginAttemptListItem's own doc comment) -- every other outcome shows
// "--" in the Status column, not one of these badges.
export const SESSION_STATUS_CONFIG: Record<LoginSessionStatus, { label: string; variant: BadgeVariant }> = {
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "neutral" },
  logged_out: { label: "Logged out", variant: "neutral" },
};

export const SESSION_STATUS_OPTIONS = optionsFrom(SESSION_STATUS_CONFIG);
