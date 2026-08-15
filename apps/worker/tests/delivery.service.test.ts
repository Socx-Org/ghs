import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "@ghs/api/logger";
import { EmailSendError } from "@ghs/api/lib/email";
import type { EmailProvider, EmailMessage, SendResult } from "@ghs/api/lib/email";
import { runDeliveryCycle } from "../src/application/delivery.service.ts";
import type { OutboxRepository, OutboxRow } from "../src/data/outbox.repository.ts";
import type { RecipientsRepository, Recipient } from "../src/data/recipients.repository.ts";

// Pure unit tests against fakes (ENG-030.3) -- no DB, no network. Real
// Postgres coverage (concurrent claim, actual retry_after eligibility,
// crash recovery) lives in outbox.integration.test.ts; this file is
// specifically about the delivery cycle's own decision logic: what it
// does with a claimed batch, given a provider that succeeds or fails in
// different ways.

const silentLogger = createLogger("test");

function fakeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "outbox-1",
    notificationHistoryId: "history-1",
    eventType: "round_submitted",
    payload: { roundId: "r1", teeConfigurationId: "t1", playedAt: "2026-05-01T09:00:00.000Z" },
    status: "processing",
    attempts: 0,
    claimedAt: new Date().toISOString(),
    retryAfter: null,
    failureReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeOutboxRepository(claimed: OutboxRow[]): OutboxRepository & {
  sentIds: string[];
  pendingRetries: Array<{ id: string; attempts: number; retryAfter: Date; failureReason: string }>;
  failedRows: Array<{ id: string; attempts: number; failureReason: string }>;
} {
  const sentIds: string[] = [];
  const pendingRetries: Array<{ id: string; attempts: number; retryAfter: Date; failureReason: string }> = [];
  const failedRows: Array<{ id: string; attempts: number; failureReason: string }> = [];
  return {
    sentIds,
    pendingRetries,
    failedRows,
    async claimBatch() {
      return claimed;
    },
    async claimStuckProcessing() {
      throw new Error("not used by these tests");
    },
    async markSent(id) {
      sentIds.push(id);
    },
    async markPendingRetry(id, attempts, retryAfter, failureReason) {
      pendingRetries.push({ id, attempts, retryAfter, failureReason });
    },
    async markFailed(id, attempts, failureReason) {
      failedRows.push({ id, attempts, failureReason });
    },
  };
}

function fakeRecipientsRepository(recipients: Map<string, Recipient>): RecipientsRepository {
  return {
    async resolveForHistoryIds() {
      return recipients;
    },
  };
}

function fakeProvider(send: (message: EmailMessage) => Promise<SendResult>): EmailProvider {
  return { send };
}

const deliveryDefaults = {
  logger: silentLogger,
  appBaseUrl: "https://ghs.test",
  batchSize: 20,
  backoffMinutes: [1, 5, 15],
  maxAttempts: 3,
};

test("an empty claim does nothing -- no recipient lookup, no provider call", async () => {
  const outbox = fakeOutboxRepository([]);
  let sendCalled = false;
  const provider = fakeProvider(async () => { sendCalled = true; return {}; });
  const recipients = fakeRecipientsRepository(new Map());

  const result = await runDeliveryCycle({ ...deliveryDefaults, outbox, recipients, provider });

  assert.deepEqual(result, { claimed: 0, sent: 0, failed: 0 });
  assert.equal(sendCalled, false);
});

test("a successful send marks the row sent and passes the rendered subject/text/html to the provider", async () => {
  const row = fakeRow();
  const outbox = fakeOutboxRepository([row]);
  const recipients = fakeRecipientsRepository(new Map([["history-1", { userId: "user-1", email: "player@example.com" }]]));
  const seenMessages: EmailMessage[] = [];
  const provider = fakeProvider(async (message) => { seenMessages.push(message); return { providerMessageId: "msg-1" }; });

  const result = await runDeliveryCycle({ ...deliveryDefaults, outbox, recipients, provider });

  assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0 });
  assert.deepEqual(outbox.sentIds, ["outbox-1"]);
  assert.equal(seenMessages.length, 1);
  assert.equal(seenMessages[0]!.to, "player@example.com");
  assert.equal(seenMessages[0]!.subject, "Round Submitted");
});

test("a retryable send failure schedules a retry via markPendingRetry, not markFailed", async () => {
  const row = fakeRow({ attempts: 0 });
  const outbox = fakeOutboxRepository([row]);
  const recipients = fakeRecipientsRepository(new Map([["history-1", { userId: "user-1", email: "player@example.com" }]]));
  const provider = fakeProvider(async () => { throw new EmailSendError("SMTP send failed: timeout", { code: "ETIMEDOUT" }); });

  const result = await runDeliveryCycle({ ...deliveryDefaults, outbox, recipients, provider });

  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1 });
  assert.equal(outbox.failedRows.length, 0);
  assert.equal(outbox.pendingRetries.length, 1);
  assert.equal(outbox.pendingRetries[0]!.attempts, 1);
  assert.match(outbox.pendingRetries[0]!.failureReason, /timeout/);
});

test("a permanent send failure goes straight to markFailed, not markPendingRetry", async () => {
  const row = fakeRow({ attempts: 0 });
  const outbox = fakeOutboxRepository([row]);
  const recipients = fakeRecipientsRepository(new Map([["history-1", { userId: "user-1", email: "player@example.com" }]]));
  const provider = fakeProvider(async () => { throw new EmailSendError("SMTP send failed: 550 no such user", { responseCode: 550 }); });

  const result = await runDeliveryCycle({ ...deliveryDefaults, outbox, recipients, provider });

  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1 });
  assert.equal(outbox.pendingRetries.length, 0);
  assert.equal(outbox.failedRows.length, 1);
  assert.equal(outbox.failedRows[0]!.attempts, 1);
});

test("retry exhaustion: a retryable failure on the last available attempt still lands in markFailed", async () => {
  const row = fakeRow({ attempts: 2 }); // maxAttempts is 3 -- this is the last one
  const outbox = fakeOutboxRepository([row]);
  const recipients = fakeRecipientsRepository(new Map([["history-1", { userId: "user-1", email: "player@example.com" }]]));
  const provider = fakeProvider(async () => { throw new EmailSendError("SMTP send failed: timeout", { code: "ETIMEDOUT" }); });

  const result = await runDeliveryCycle({ ...deliveryDefaults, outbox, recipients, provider });

  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1 });
  assert.equal(outbox.pendingRetries.length, 0);
  assert.equal(outbox.failedRows.length, 1);
  assert.equal(outbox.failedRows[0]!.attempts, 3);
});

test("a row with no resolvable recipient is marked permanently failed, not retried -- the provider is never called for it", async () => {
  const row = fakeRow();
  const outbox = fakeOutboxRepository([row]);
  const recipients = fakeRecipientsRepository(new Map()); // empty -- no match for history-1
  let sendCalled = false;
  const provider = fakeProvider(async () => { sendCalled = true; return {}; });

  const result = await runDeliveryCycle({ ...deliveryDefaults, outbox, recipients, provider });

  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1 });
  assert.equal(sendCalled, false);
  assert.equal(outbox.failedRows.length, 1);
  assert.match(outbox.failedRows[0]!.failureReason, /no recipient/);
});

test("one row's failure does not prevent the rest of the batch from being processed -- each row is isolated", async () => {
  const rows = [
    fakeRow({ id: "outbox-1", notificationHistoryId: "history-1" }),
    fakeRow({ id: "outbox-2", notificationHistoryId: "history-2" }),
    fakeRow({ id: "outbox-3", notificationHistoryId: "history-3" }),
  ];
  const outbox = fakeOutboxRepository(rows);
  const recipients = fakeRecipientsRepository(new Map([
    ["history-1", { userId: "u1", email: "a@example.com" }],
    ["history-2", { userId: "u2", email: "b@example.com" }],
    ["history-3", { userId: "u3", email: "c@example.com" }],
  ]));
  const provider = fakeProvider(async (message) => {
    if (message.to === "b@example.com") throw new EmailSendError("SMTP send failed: 550 rejected", { responseCode: 550 });
    return {};
  });

  const result = await runDeliveryCycle({ ...deliveryDefaults, outbox, recipients, provider });

  assert.deepEqual(result, { claimed: 3, sent: 2, failed: 1 });
  assert.deepEqual(outbox.sentIds.sort(), ["outbox-1", "outbox-3"]);
  assert.deepEqual(outbox.failedRows.map((r) => r.id), ["outbox-2"]);
});
