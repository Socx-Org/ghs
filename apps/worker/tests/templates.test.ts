import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNotification } from "../src/application/templates.ts";

// Pure unit tests -- no DB, no network (ENG-030.3). One test per real
// event type (ghs#39's definitive 9-event inventory), confirming every
// payload field this codebase actually writes (see notifications.
// repository.ts's real call sites) renders into the message, and that
// preserved legacy subject lines (found in legacy GHS's own lib/email.ts)
// are kept verbatim where content this rebuild still has supports them.

const APP_BASE_URL = "https://ghs.test";

test("round_submitted", () => {
  const rendered = renderNotification("round_submitted", { roundId: "r1", teeConfigurationId: "t1", playedAt: "2026-05-01T09:00:00.000Z" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Round Submitted");
  assert.match(rendered.text, /2026-05-01T09:00:00\.000Z/);
  assert.match(rendered.html, /2026-05-01T09:00:00\.000Z/);
});

test("round_approved (ordinary approval)", () => {
  const rendered = renderNotification("round_approved", { roundId: "r1", trigger: "round_approved" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Round Approved");
  assert.match(rendered.text, /your round has been.*approved/i);
});

test("round_approved (amendment re-approval) uses different wording from an ordinary approval, same subject (ghs#25's own trigger table: 'same as ordinary approval')", () => {
  const rendered = renderNotification("round_approved", { roundId: "r1", trigger: "amendment_approved" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Round Approved");
  assert.match(rendered.text, /amended round/i);
});

test("round_rejected includes the mandatory reason (no legacy precedent -- new content)", () => {
  const rendered = renderNotification("round_rejected", { roundId: "r1", reason: "Illegible scorecard" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Round Rejected");
  assert.match(rendered.text, /Illegible scorecard/);
  assert.match(rendered.html, /Illegible scorecard/);
});

test("round_rejected HTML-escapes the free-text reason -- a rejecting admin's own words must not be able to inject markup into the email (PR #47 review fix)", () => {
  const rendered = renderNotification("round_rejected", { roundId: "r1", reason: `<script>alert(1)</script> & "quoted" 'text'` }, APP_BASE_URL);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot; &#39;text&#39;/);
  // The plain-text body is never parsed as markup -- escaping it would
  // just corrupt the reason as read by a human, so it stays as-is there.
  assert.match(rendered.text, /<script>alert\(1\)<\/script> & "quoted" 'text'/);
});

test("handicap_changed -- subject preserved verbatim from legacy's 'handicap_update' template", () => {
  const rendered = renderNotification("handicap_changed", { trigger: "round_approved", previousIndex: 15.4, newIndex: 14.1, historyRecordId: "h1" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Your handicap index has been updated");
  assert.match(rendered.text, /15\.4/);
  assert.match(rendered.text, /14\.1/);
});

test("handicap_changed with no previous index (a player's first-ever calculation) renders 'N/A', same as legacy's own null handling", () => {
  const rendered = renderNotification("handicap_changed", { trigger: "round_approved", previousIndex: null, newIndex: 20.0, historyRecordId: "h1" }, APP_BASE_URL);
  assert.match(rendered.text, /N\/A/);
});

test("manual_override includes the admin's reason and both index values (no legacy precedent -- new content)", () => {
  const rendered = renderNotification("manual_override", { overrideId: "o1", previousIndex: 18.0, newIndex: 12.0, reason: "Verified against a paper certificate", adminUserId: "admin-1" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Your handicap index has been manually adjusted");
  assert.match(rendered.text, /12\.0/);
  assert.match(rendered.text, /Verified against a paper certificate/);
});

test("manual_override HTML-escapes the free-text reason -- same injection risk as round_rejected (PR #47 review fix)", () => {
  const rendered = renderNotification("manual_override", { overrideId: "o1", previousIndex: 18.0, newIndex: 12.0, reason: "<b>bold</b>", adminUserId: "admin-1" }, APP_BASE_URL);
  assert.doesNotMatch(rendered.html, /<b>bold<\/b>/);
  assert.match(rendered.html, /&lt;b&gt;bold&lt;\/b&gt;/);
});

// ghs#163: this exact test previously asserted /activate-account, the
// wrong path -- matching the real, shipped bug rather than catching it.
// AppRoutes.tsx's real route is /activate; confirmed directly, not
// assumed, by reading that file before fixing this one.
test("account_activation -- subject preserved verbatim from legacy, builds a real activation URL matching the real /activate route", () => {
  const rendered = renderNotification("account_activation", { email: "jane@example.com", token: "raw-token-abc", expiresAt: "2026-08-17T00:00:00.000Z" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Activate your account");
  assert.match(rendered.text, /https:\/\/ghs\.test\/activate\?token=raw-token-abc/);
  assert.doesNotMatch(rendered.text, /activate-account/, "must not regress to the wrong path (ghs#163)");
  assert.doesNotMatch(rendered.text, /raw-token-abc.*raw-token-abc/, "token appears in the URL, not duplicated as a bare value elsewhere");
});

test("account_activation_resend uses the same subject and activation-link content as the original (same call to action)", () => {
  const rendered = renderNotification("account_activation_resend", { email: "jane@example.com", token: "resend-token", expiresAt: "2026-08-17T00:00:00.000Z" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Activate your account");
  assert.match(rendered.text, /https:\/\/ghs\.test\/activate\?token=resend-token/);
});

test("account_activation_admin_invite -- distinct wording (no direct legacy precedent), still a real activation link matching the real /activate route", () => {
  const rendered = renderNotification("account_activation_admin_invite", { email: "invited@example.com", token: "invite-token", expiresAt: "2026-08-17T00:00:00.000Z" }, APP_BASE_URL);
  assert.match(rendered.subject, /invited/i);
  assert.match(rendered.text, /administrator/i);
  assert.match(rendered.text, /https:\/\/ghs\.test\/activate\?token=invite-token/);
});

test("password_reset -- subject preserved verbatim from legacy, builds a real reset URL from the raw token", () => {
  const rendered = renderNotification("password_reset", { email: "jane@example.com", token: "reset-token-xyz", expiresAt: "2026-08-16T13:00:00.000Z" }, APP_BASE_URL);
  assert.equal(rendered.subject, "Reset your password");
  assert.match(rendered.text, /https:\/\/ghs\.test\/reset-password\?token=reset-token-xyz/);
});

test("a raw token is never left out of the link -- URL-encoded, not silently dropped or truncated, even for unusual characters", () => {
  const rendered = renderNotification("password_reset", { email: "jane@example.com", token: "abc+def/ghi=", expiresAt: "2026-08-16T13:00:00.000Z" }, APP_BASE_URL);
  assert.match(rendered.text, /token=abc%2Bdef%2Fghi%3D/);
});
