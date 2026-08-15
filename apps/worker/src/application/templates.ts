import type { NotificationEventType } from "@ghs/api/data/notifications.repository";

export interface RenderedNotification {
  subject: string;
  text: string;
  html: string;
}

// ghs#42 discovery: no template/content of any kind exists in this
// rebuild (confirmed by direct search -- lib/email.ts is transport-only).
// Legacy GHS (apps/api/src/lib/email.ts there) has real, shipped wording
// for 4 of these 9 events (password_reset, account_activation,
// handicap_update, round_update) -- reused/adapted below, subject lines
// preserved verbatim where the payload shape still supports them. Two
// things legacy's templates needed are NOT in the new, deliberately
// minimal payloads this rebuild writes (ghs#25/ghs#39): course name and
// gross/adjusted scores for round events, and a "rounds used" count for
// handicap events. Enriching payloads or looking up that denormalized
// data at delivery time is a real, separate content improvement, not
// this issue's scope (ghs#42 is delivery mechanics) -- content is
// intentionally kept to exactly what the durable payload already
// carries. round_rejected, manual_override, account_activation_resend,
// and account_activation_admin_invite have no legacy precedent at all
// (never emailed in legacy, or -- for the resend/admin-invite variants --
// didn't exist as distinct events); wording for those is new, written in
// the same plain style as the preserved templates.

interface RoundSubmittedPayload {
  roundId: string;
  playedAt: string;
}

interface RoundApprovedPayload {
  roundId: string;
  trigger: string;
}

interface RoundRejectedPayload {
  roundId: string;
  reason: string;
}

interface HandicapChangedPayload {
  previousIndex: number | null;
  newIndex: number;
}

interface ManualOverridePayload {
  previousIndex: number;
  newIndex: number;
  reason: string;
}

interface TokenActionPayload {
  token: string;
  expiresAt: string;
}

function formatIndex(index: number | null | undefined): string {
  return typeof index === "number" ? index.toFixed(1) : "N/A";
}

// round_rejected's reason and manual_override's reason are free text (a
// rejecting admin/approver, or an overriding admin, types this) -- unlike
// every other interpolated value here (IDs, dates, numbers), it must be
// HTML-escaped before landing in the html body, or it could malform the
// markup or, in some mail clients, inject content (PR #47 review fix).
// text bodies need no escaping -- they're never parsed as markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function activationUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/activate-account?token=${encodeURIComponent(token)}`;
}

function resetUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

export function renderNotification(
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
  appBaseUrl: string,
): RenderedNotification {
  switch (eventType) {
    case "round_submitted": {
      const p = payload as unknown as RoundSubmittedPayload;
      return {
        subject: "Round Submitted",
        text: `Your round played on ${p.playedAt} has been submitted and is awaiting approval.\n\nSign in to view your round details.`,
        html: `<p>Your round played on ${p.playedAt} has been submitted and is awaiting approval.</p><p>Sign in to view your round details.</p>`,
      };
    }

    case "round_approved": {
      const p = payload as unknown as RoundApprovedPayload;
      const isAmendment = p.trigger === "amendment_approved";
      return {
        subject: "Round Approved",
        text: `Your ${isAmendment ? "amended round" : "round"} has been approved.\n\nSign in to view your round details.`,
        html: `<p>Your ${isAmendment ? "amended round" : "round"} has been <strong>approved</strong>.</p><p>Sign in to view your round details.</p>`,
      };
    }

    case "round_rejected": {
      const p = payload as unknown as RoundRejectedPayload;
      return {
        subject: "Round Rejected",
        text: `Your round has been rejected.\n\nReason: ${p.reason}\n\nSign in to view your round details.`,
        html: `<p>Your round has been <strong>rejected</strong>.</p><p><strong>Reason:</strong> ${escapeHtml(p.reason)}</p><p>Sign in to view your round details.</p>`,
      };
    }

    case "handicap_changed": {
      const p = payload as unknown as HandicapChangedPayload;
      const oldIndexLabel = formatIndex(p.previousIndex);
      const newIndexLabel = formatIndex(p.newIndex);
      return {
        subject: "Your handicap index has been updated",
        text: `Your handicap index has changed.\n\nOld index: ${oldIndexLabel}\nNew index: ${newIndexLabel}\n\nSign in to view your full handicap history.`,
        html: `<p>Your handicap index has changed.</p><ul><li><strong>Old index:</strong> ${oldIndexLabel}</li><li><strong>New index:</strong> ${newIndexLabel}</li></ul><p>Sign in to view your full handicap history.</p>`,
      };
    }

    case "manual_override": {
      const p = payload as unknown as ManualOverridePayload;
      const previousLabel = formatIndex(p.previousIndex);
      const newLabel = formatIndex(p.newIndex);
      return {
        subject: "Your handicap index has been manually adjusted",
        text: `An administrator has manually adjusted your handicap index.\n\nPrevious index: ${previousLabel}\nNew index: ${newLabel}\nReason: ${p.reason}\n\nSign in to view your full handicap history.`,
        html: `<p>An administrator has manually adjusted your handicap index.</p><ul><li><strong>Previous index:</strong> ${previousLabel}</li><li><strong>New index:</strong> ${newLabel}</li><li><strong>Reason:</strong> ${escapeHtml(p.reason)}</li></ul><p>Sign in to view your full handicap history.</p>`,
      };
    }

    case "account_activation":
    case "account_activation_resend": {
      const p = payload as unknown as TokenActionPayload;
      const url = activationUrl(appBaseUrl, p.token);
      return {
        subject: "Activate your account",
        text: `Welcome to Golf Handicap System. Activate your account using this link (expires ${p.expiresAt}):\n\n${url}\n\nIf you did not request this account, ignore this email.`,
        html: `<p>Welcome to Golf Handicap System.</p><p>Activate your account using the link below (expires ${p.expiresAt}):</p><p><a href="${url}">${url}</a></p><p>If you did not request this account, ignore this email.</p>`,
      };
    }

    case "account_activation_admin_invite": {
      const p = payload as unknown as TokenActionPayload;
      const url = activationUrl(appBaseUrl, p.token);
      return {
        subject: "You've been invited to Golf Handicap System",
        text: `An administrator has created an account for you on Golf Handicap System. Activate it using this link (expires ${p.expiresAt}):\n\n${url}\n\nIf you were not expecting this invitation, ignore this email.`,
        html: `<p>An administrator has created an account for you on Golf Handicap System.</p><p>Activate it using the link below (expires ${p.expiresAt}):</p><p><a href="${url}">${url}</a></p><p>If you were not expecting this invitation, ignore this email.</p>`,
      };
    }

    case "password_reset": {
      const p = payload as unknown as TokenActionPayload;
      const url = resetUrl(appBaseUrl, p.token);
      return {
        subject: "Reset your password",
        text: `You requested a password reset. Use this link (expires ${p.expiresAt}):\n\n${url}\n\nIf you did not request this, ignore this email.`,
        html: `<p>You requested a password reset. Click the link below (expires ${p.expiresAt}):</p><p><a href="${url}">${url}</a></p><p>If you did not request this, ignore this email.</p>`,
      };
    }
  }
}
