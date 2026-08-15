import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyMigrations } from "@ghs/api/data/migrations/apply";
import { createUsersRepository } from "@ghs/api/data/users.repository";
import { createLogger } from "@ghs/api/logger";
import { EmailSendError } from "@ghs/api/lib/email";
import type { EmailProvider, EmailMessage, SendResult } from "@ghs/api/lib/email";
import { createOutboxRepository } from "../src/data/outbox.repository.ts";
import { createRecipientsRepository } from "../src/data/recipients.repository.ts";
import { createRetentionRepository } from "../src/data/retention.repository.ts";
import { runDeliveryCycle } from "../src/application/delivery.service.ts";
import { runCrashRecoverySweep } from "../src/application/crash-recovery.service.ts";

// Real Postgres coverage of ghs#42's own required test list: concurrent
// claiming (a genuine two-connection test, not just reading the SQL),
// the full success/retryable/permanent/exhaustion/crash-recovery
// lifecycle, and retention cleanup.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE clubs, users, system_settings RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

async function createRealUser(email: string): Promise<string> {
  const users = createUsersRepository(pool);
  const user = await users.create({ email, passwordHash: "irrelevant-for-this-test", role: "player", status: "active" });
  return user.id;
}

async function insertOutboxRow(
  userId: string,
  overrides: Partial<{ status: string; attempts: number; claimedAt: Date | null; retryAfter: Date | null }> = {},
): Promise<string> {
  const historyResult = await pool.query<{ id: string }>(
    "INSERT INTO notification_history (user_id, event_type, payload) VALUES ($1, 'round_submitted', $2::jsonb) RETURNING id",
    [userId, JSON.stringify({ roundId: "r1", teeConfigurationId: "t1", playedAt: "2026-05-01T09:00:00.000Z" })],
  );
  const historyId = historyResult.rows[0]!.id;
  const outboxResult = await pool.query<{ id: string }>(
    `INSERT INTO notification_outbox (notification_history_id, event_type, payload, status, attempts, claimed_at, retry_after)
     VALUES ($1, 'round_submitted', $2::jsonb, $3, $4, $5, $6) RETURNING id`,
    [
      historyId,
      JSON.stringify({ roundId: "r1", teeConfigurationId: "t1", playedAt: "2026-05-01T09:00:00.000Z" }),
      overrides.status ?? "pending",
      overrides.attempts ?? 0,
      overrides.claimedAt ?? null,
      overrides.retryAfter ?? null,
    ],
  );
  return outboxResult.rows[0]!.id;
}

async function outboxRow(id: string): Promise<{ status: string; attempts: number; retry_after: Date | null; claimed_at: Date | null }> {
  const result = await pool.query("SELECT status, attempts, retry_after, claimed_at FROM notification_outbox WHERE id = $1", [id]);
  return result.rows[0];
}

function fakeProvider(send: (message: EmailMessage) => Promise<SendResult>): EmailProvider {
  return { send };
}

test("two concurrent claims never grab the same row -- real two-connection proof of FOR UPDATE SKIP LOCKED", async () => {
  const userId = await createRealUser("concurrent-claim@example.com");
  const ids = await Promise.all(Array.from({ length: 10 }, () => insertOutboxRow(userId)));

  const poolA = new Pool({ connectionString: process.env.DATABASE_URL });
  const poolB = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const repoA = createOutboxRepository(poolA);
    const repoB = createOutboxRepository(poolB);

    const [batchA, batchB] = await Promise.all([repoA.claimBatch(5), repoB.claimBatch(5)]);

    const idsA = batchA.map((r) => r.id);
    const idsB = batchB.map((r) => r.id);
    const overlap = idsA.filter((id) => idsB.includes(id));

    assert.deepEqual(overlap, [], "no row was claimed by both connections");
    assert.equal(idsA.length + idsB.length, 10, "every row was claimed exactly once, none lost, none double-claimed");
    assert.deepEqual([...idsA, ...idsB].sort(), [...ids].sort());
  } finally {
    await poolA.end();
    await poolB.end();
  }
});

test("full success lifecycle: pending -> processing (claim) -> sent, attempt count and timestamps correct, real Postgres", async () => {
  const userId = await createRealUser("lifecycle@example.com");
  const id = await insertOutboxRow(userId);

  const outbox = createOutboxRepository(pool);
  const claimed = await outbox.claimBatch(20);
  const row = claimed.find((r) => r.id === id)!;
  assert.equal(row.status, "processing");
  assert.ok(row.claimedAt);
  assert.equal(row.attempts, 0);

  await outbox.markSent(id, row.attempts + 1);
  const after = await outboxRow(id);
  assert.equal(after.status, "sent");
  assert.equal(after.attempts, 1, "attempts includes the successful send itself (PR #47 review fix)");
  assert.equal(after.retry_after, null);
});

test("a pending row not yet due for retry (retry_after in the future) is not claimable", async () => {
  const userId = await createRealUser("not-yet-due@example.com");
  const id = await insertOutboxRow(userId, { status: "pending", attempts: 1, retryAfter: new Date(Date.now() + 60 * 60 * 1000) });

  const outbox = createOutboxRepository(pool);
  const claimed = await outbox.claimBatch(20);
  assert.ok(!claimed.some((r) => r.id === id));
});

test("retryable failure: attempt increments, retry scheduled, and the row becomes eligible again once retry_after has passed, real Postgres", async () => {
  const userId = await createRealUser("retryable@example.com");
  const id = await insertOutboxRow(userId);
  const outbox = createOutboxRepository(pool);

  await outbox.claimBatch(20);
  await outbox.markPendingRetry(id, 1, new Date(Date.now() - 1000), "simulated retryable failure");

  const afterFailure = await outboxRow(id);
  assert.equal(afterFailure.status, "pending");
  assert.equal(afterFailure.attempts, 1);

  const claimedAgain = await outbox.claimBatch(20);
  assert.ok(claimedAgain.some((r) => r.id === id), "eligible again now that retry_after is in the past");
});

test("a row that fails once then succeeds on retry ends up with no stale retry_after/failure_reason -- markSent clears both, real Postgres (PR #47 review fix)", async () => {
  const userId = await createRealUser("recovers-then-succeeds@example.com");
  const id = await insertOutboxRow(userId);
  const outbox = createOutboxRepository(pool);

  await outbox.claimBatch(20);
  await outbox.markPendingRetry(id, 1, new Date(Date.now() - 1000), "simulated retryable failure");

  const [reclaimed] = await outbox.claimBatch(20);
  assert.equal(reclaimed!.id, id);
  await outbox.markSent(id, reclaimed!.attempts + 1);

  const after = await outboxRow(id);
  assert.equal(after.status, "sent");
  assert.equal(after.attempts, 2, "counts both the original failed attempt and the successful one");
  assert.equal(after.retry_after, null, "no stale retry_after left over from the earlier failure");
  const failureReason = await pool.query("SELECT failure_reason FROM notification_outbox WHERE id = $1", [id]);
  assert.equal(failureReason.rows[0]!.failure_reason, null, "no stale failure_reason left over from the earlier failure");
});

test("permanent failure: row becomes failed immediately, no further attempts, real Postgres", async () => {
  const userId = await createRealUser("permanent@example.com");
  const id = await insertOutboxRow(userId);
  const outbox = createOutboxRepository(pool);

  await outbox.claimBatch(20);
  await outbox.markFailed(id, 1, "simulated permanent failure");

  const after = await outboxRow(id);
  assert.equal(after.status, "failed");
  assert.equal(after.retry_after, null);

  const claimedAgain = await outbox.claimBatch(20);
  assert.ok(!claimedAgain.some((r) => r.id === id), "a failed row is never claimable again");
});

test("retry exhaustion: a retryable failure repeated through the full backoff schedule eventually becomes failed, real Postgres + runDeliveryCycle", async () => {
  const userId = await createRealUser("exhaustion@example.com");
  const id = await insertOutboxRow(userId);
  const outbox = createOutboxRepository(pool);
  const recipients = createRecipientsRepository(pool);
  const alwaysFails = fakeProvider(async () => {
    throw new EmailSendError("SMTP send failed: timeout", { code: "ETIMEDOUT" });
  });
  const deliveryDeps = { outbox, recipients, provider: alwaysFails, logger, appBaseUrl: "https://ghs.test", batchSize: 20, backoffMinutes: [1, 5, 15] };

  // 4 total attempts allowed: the initial one plus one retry per
  // configured backoff entry (PR #47 review fix -- every entry in [1, 5,
  // 15] is now reachable, not just the first two).
  for (let i = 0; i < 4; i++) {
    // Force immediate eligibility each pass -- this test exercises the
    // attempts/exhaustion logic, not real wall-clock backoff delays.
    await pool.query("UPDATE notification_outbox SET retry_after = now() - interval '1 second' WHERE id = $1", [id]);
    await runDeliveryCycle(deliveryDeps);
  }

  const after = await outboxRow(id);
  assert.equal(after.status, "failed");
  assert.equal(after.attempts, 4);
});

test("a processing row still within the crash-recovery timeout is not reclaimed", async () => {
  const userId = await createRealUser("not-stuck-yet@example.com");
  const id = await insertOutboxRow(userId, { status: "processing", claimedAt: new Date(Date.now() - 60 * 1000) }); // 1 minute ago

  const outbox = createOutboxRepository(pool);
  const stuck = await outbox.claimStuckProcessing(5, 20); // 5-minute timeout
  assert.ok(!stuck.some((r) => r.id === id));
});

test("crash recovery: an abandoned processing row becomes reclaimable and is processed again, attempts incremented, real Postgres + runCrashRecoverySweep", async () => {
  const userId = await createRealUser("crashed@example.com");
  const id = await insertOutboxRow(userId, { status: "processing", claimedAt: new Date(Date.now() - 10 * 60 * 1000) }); // 10 minutes ago

  const outbox = createOutboxRepository(pool);
  const result = await runCrashRecoverySweep({ outbox, logger, timeoutMinutes: 5, batchSize: 20, backoffMinutes: [1, 5, 15] });

  assert.equal(result.reclaimed, 1);
  const after = await outboxRow(id);
  assert.equal(after.status, "pending", "reclaimed back to pending, not left stuck in processing forever");
  assert.equal(after.attempts, 1, "the reclaim counts as a real attempt, not a free retry (ADR-210 point 7)");
  assert.ok(after.retry_after, "a real backoff delay applies, same as any other retryable failure");
});

test("crash recovery: a poison message that keeps crashing the worker eventually lands in failed, not an infinite reclaim loop", async () => {
  const userId = await createRealUser("poison@example.com");
  const id = await insertOutboxRow(userId, { status: "processing", claimedAt: new Date(Date.now() - 10 * 60 * 1000), attempts: 3 }); // already at attempts=3 -- the schedule's last entry (backoffMinutes[2]) was already used

  const outbox = createOutboxRepository(pool);
  const result = await runCrashRecoverySweep({ outbox, logger, timeoutMinutes: 5, batchSize: 20, backoffMinutes: [1, 5, 15] });

  assert.equal(result.reclaimed, 1);
  const after = await outboxRow(id);
  assert.equal(after.status, "failed");
  assert.equal(after.attempts, 4);
});

test("retention cleanup deletes old sent/failed outbox rows but not recent ones, bounded per call, real Postgres", async () => {
  const userId = await createRealUser("retention@example.com");

  const oldSentId = await insertOutboxRow(userId, { status: "sent" });
  await pool.query("UPDATE notification_outbox SET updated_at = now() - interval '8 days' WHERE id = $1", [oldSentId]);

  const recentSentId = await insertOutboxRow(userId, { status: "sent" });

  const oldFailedId = await insertOutboxRow(userId, { status: "failed" });
  await pool.query("UPDATE notification_outbox SET updated_at = now() - interval '31 days' WHERE id = $1", [oldFailedId]);

  const recentFailedId = await insertOutboxRow(userId, { status: "failed" });

  const retention = createRetentionRepository(pool);
  const deletedSent = await retention.deleteRetiredSentOutbox(7, 1000);
  const deletedFailed = await retention.deleteRetiredFailedOutbox(30, 1000);

  assert.equal(deletedSent, 1);
  assert.equal(deletedFailed, 1);

  const remaining = await pool.query<{ id: string }>("SELECT id FROM notification_outbox ORDER BY id");
  const remainingIds = remaining.rows.map((r) => r.id);
  assert.ok(!remainingIds.includes(oldSentId));
  assert.ok(!remainingIds.includes(oldFailedId));
  assert.ok(remainingIds.includes(recentSentId), "sent rows within the 7-day retention window survive");
  assert.ok(remainingIds.includes(recentFailedId), "failed rows within the 30-day retention window survive");
});

test("retention cleanup deletes old notification_history rows but not recent ones, real Postgres", async () => {
  const userId = await createRealUser("history-retention@example.com");

  const oldHistory = await pool.query<{ id: string }>(
    "INSERT INTO notification_history (user_id, event_type, payload) VALUES ($1, 'round_submitted', '{}'::jsonb) RETURNING id",
    [userId],
  );
  await pool.query("UPDATE notification_history SET created_at = now() - interval '366 days' WHERE id = $1", [oldHistory.rows[0]!.id]);

  const recentHistory = await pool.query<{ id: string }>(
    "INSERT INTO notification_history (user_id, event_type, payload) VALUES ($1, 'round_submitted', '{}'::jsonb) RETURNING id",
    [userId],
  );

  const retention = createRetentionRepository(pool);
  const deleted = await retention.deleteRetiredHistory(365, 1000);
  assert.equal(deleted, 1);

  const remaining = await pool.query<{ id: string }>("SELECT id FROM notification_history");
  const remainingIds = remaining.rows.map((r) => r.id);
  assert.ok(!remainingIds.includes(oldHistory.rows[0]!.id));
  assert.ok(remainingIds.includes(recentHistory.rows[0]!.id));
});

test("runDeliveryCycle resolves the recipient's real, current email via user_id -- not a stale copy from the payload, real Postgres", async () => {
  const users = createUsersRepository(pool);
  const user = await users.create({ email: "original@example.com", passwordHash: "irrelevant", role: "player", status: "active" });
  const id = await insertOutboxRow(user.id);

  // The user's address changes after the notification was queued but
  // before delivery -- a real scenario async delivery must handle
  // correctly (ADR-210's own "enough durable payload info" framing,
  // section 11 of this phase's brief: user_id is the durable, correct
  // join key, not a denormalized copy of the address).
  await pool.query("UPDATE users SET email = 'changed@example.com' WHERE id = $1", [user.id]);

  const outbox = createOutboxRepository(pool);
  const recipients = createRecipientsRepository(pool);
  const seenMessages: EmailMessage[] = [];
  const provider = fakeProvider(async (message) => { seenMessages.push(message); return {}; });

  await runDeliveryCycle({ outbox, recipients, provider, logger, appBaseUrl: "https://ghs.test", batchSize: 20, backoffMinutes: [1, 5, 15] });

  assert.equal(seenMessages.length, 1);
  assert.equal(seenMessages[0]!.to, "changed@example.com");
  const after = await outboxRow(id);
  assert.equal(after.status, "sent");
});
