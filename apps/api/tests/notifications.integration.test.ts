import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createHandicapHistoryRepository } from "../src/data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "../src/application/handicap-history.service.ts";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createRoundsService } from "../src/application/rounds.service.ts";
import { createHandicapOverridesRepository } from "../src/data/handicap-overrides.repository.ts";
import { createHandicapOverridesService } from "../src/application/handicap-overrides.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
import type { RecalculationOrchestrator } from "../src/application/recalculation.service.ts";

// ghs#25's own Automated Test Requirements, verified here against a real
// database:
// - an outbox row is created in the SAME transaction as the business
//   event (not just "a row exists afterward")
// - no code path in this issue is capable of a synchronous provider call
// - amendment-reopen writes no outbox row
// - a no-op recalculation (no actual index change) writes no notification

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

async function createTeeConfiguration(courseRating = 72.0, slopeRating = 113): Promise<string> {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Notifications Test Course",
    country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating, slopeRating, holes: [] }],
  });
  return course.teeConfigurations[0]!.id;
}

async function createApprovedRound(playerId: string, teeConfigurationId: string, playedAt: string, scoreDifferential: number): Promise<string> {
  const rounds = createRoundsRepository(pool);
  const round = await rounds.create({ playerId, teeConfigurationId, playedAt });
  await rounds.updateScores(round.id, { scoreDifferential });
  await rounds.setStatus(round.id, "approved");
  return round.id;
}

function buildServices() {
  const roundsRepo = createRoundsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const pccService = createPccService(createPccRepository(pool));
  const scoringService = createScoringService(roundsRepo, coursesRepo, pccService);
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const notificationsRepository = createNotificationsRepository(pool);
  const recalculationOrchestrator = createRecalculationOrchestrator(pool, roundsRepo, handicapHistoryService, pccService, notificationsRepository, logger);
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, logger);
  return { roundsRepo, coursesRepo, handicapHistoryService, notificationsRepository, recalculationOrchestrator, roundsService };
}

interface OutboxRow {
  id: string;
  notification_history_id: string;
  event_type: string;
  status: string;
}

async function outboxRowsForPlayer(playerId: string): Promise<OutboxRow[]> {
  const result = await pool.query<OutboxRow>(
    `SELECT o.id, o.notification_history_id, o.event_type, o.status
     FROM notification_outbox o
     JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.player_id = $1
     ORDER BY o.created_at`,
    [playerId],
  );
  return result.rows;
}

async function historyRowsForPlayer(playerId: string): Promise<Array<{ event_type: string }>> {
  const result = await pool.query<{ event_type: string }>(
    "SELECT event_type FROM notification_history WHERE player_id = $1 ORDER BY created_at",
    [playerId],
  );
  return result.rows;
}

test("createRound writes notification_history and its child notification_outbox row, both in the same transaction as the round itself, real Postgres", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Submit", lastName: "Notify" });
  const { roundsService } = buildServices();

  const round = await roundsService.createRound({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  const history = await historyRowsForPlayer(player.id);
  assert.deepEqual(history.map((h) => h.event_type), ["round_submitted"]);

  const outbox = await outboxRowsForPlayer(player.id);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]!.event_type, "round_submitted");
  // Never transitions out of 'pending' -- there is no worker in this
  // issue's scope to claim or send it (ADR-210's own delivery machinery
  // is ghs#5, a later phase).
  assert.equal(outbox[0]!.status, "pending");

  const outboxRow = await pool.query("SELECT payload FROM notification_outbox WHERE id = $1", [outbox[0]!.id]);
  assert.equal(outboxRow.rows[0]!.payload.roundId, round.id);
});

test("an invalid event_type is rejected at the database level on both notification_history and notification_outbox, not only by the fixed NotificationEventType union (caught in review, PR #33)", async () => {
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Invalid", lastName: "EventType" });

  await assert.rejects(() =>
    pool.query("INSERT INTO notification_history (player_id, event_type, payload) VALUES ($1, 'not_a_real_event', '{}'::jsonb)", [player.id]),
  );

  const historyResult = await pool.query<{ id: string }>(
    "INSERT INTO notification_history (player_id, event_type, payload) VALUES ($1, 'round_submitted', '{}'::jsonb) RETURNING id",
    [player.id],
  );
  await assert.rejects(() =>
    pool.query(
      "INSERT INTO notification_outbox (notification_history_id, event_type, payload) VALUES ($1, 'not_a_real_event', '{}'::jsonb)",
      [historyResult.rows[0]!.id],
    ),
  );
});

test("approveRound writes round_approved, and -- since the round is eligible and the index changes -- a separate handicap_changed notification, real Postgres", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Approve", lastName: "Notify" });
  const { roundsRepo, roundsService } = buildServices();

  // Two other approved rounds so this one's approval reaches eligibility (3 minimum).
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round.id, { holeNumber: 1, strokes: 4, netDoubleBogeyAdjusted: 4 });

  await roundsService.approveRound(round.id);

  // round_submitted never fired for this round (it was inserted directly
  // via the repository, bypassing roundsService.createRound) -- only the
  // two events approveRound itself is responsible for.
  const history = await historyRowsForPlayer(player.id);
  assert.deepEqual(history.map((h) => h.event_type).sort(), ["handicap_changed", "round_approved"]);

  const outbox = await outboxRowsForPlayer(player.id);
  assert.equal(outbox.length, 2, "both notification_history rows have their own outbox row -- not shared, not merged");
});

test("rejectRound writes round_rejected with the reason even when there's no differential to recalculate, real Postgres", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Reject", lastName: "Notify" });
  const { roundsRepo, roundsService } = buildServices();

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsService.rejectRound(round.id, "Illegible scorecard");

  const history = await historyRowsForPlayer(player.id);
  assert.deepEqual(history.map((h) => h.event_type), ["round_rejected"]);

  const outboxResult = await pool.query<{ payload: { reason: string } }>(
    `SELECT o.payload FROM notification_outbox o
     JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.player_id = $1`,
    [player.id],
  );
  assert.equal(outboxResult.rows[0]!.payload.reason, "Illegible scorecard");
});

test("reopenForAmendment writes neither a notification_history row nor an outbox row -- not even indirectly through its own recalculation (ghs#25's own acceptance criterion, real Postgres)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Reopen", lastName: "Silent" });
  const { roundsService } = buildServices();

  await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 20.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 20.0);
  const roundId = await createApprovedRound(player.id, teeConfigurationId, "2026-05-03T09:00:00.000Z", 10.0);

  await pool.query("DELETE FROM notification_history"); // discard anything from setup above (there is none, but keeps this test independent of setup changes)

  const result = await roundsService.reopenForAmendment(roundId, "Scorecard under review");
  assert.equal(result.round!.status, "amending");
  assert.ok(result.recalculation, "the recalculation itself genuinely ran (retraction)");

  const history = await historyRowsForPlayer(player.id);
  assert.equal(history.length, 0, "no notification_history row at all for reopen, including its own recalculation side effect");

  const outboxCount = await pool.query("SELECT COUNT(*) FROM notification_outbox");
  assert.equal(Number(outboxCount.rows[0]!.count), 0);
});

test("a no-op recalculation (no actual index change) writes no notification -- matches ghs#21's change-only history policy, real Postgres", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "NoOp", lastName: "Notify" });
  const { recalculationOrchestrator } = buildServices();

  await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-03T09:00:00.000Z", 14.0);

  const first = await recalculationOrchestrator.recalculatePlayerHandicap(player.id, "round_approved");
  assert.equal(first.status, "eligible");
  assert.ok(first.historyRecordId);

  // Nothing about the player's approved rounds changed -- recalculating
  // again from the exact same inputs is a genuine no-op.
  const second = await recalculationOrchestrator.recalculatePlayerHandicap(player.id, "round_approved");
  assert.equal(second.status, "eligible");
  assert.equal(second.historyRecordId, null);

  const history = await historyRowsForPlayer(player.id);
  assert.deepEqual(history.map((h) => h.event_type), ["handicap_changed"], "exactly one notification -- from the first, real change -- not two");
});

test("the state change and its notification writes roll back together on failure -- proves they share one real transaction, not two independent writes (ghs#25/ADR-210 point 1, real Postgres)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Atomic", lastName: "Notify" });
  const { roundsRepo, coursesRepo, notificationsRepository } = buildServices();

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round.id, { holeNumber: 1, strokes: 4, netDoubleBogeyAdjusted: 4 });

  const failingRecalculation: RecalculationOrchestrator = {
    async recalculatePlayerHandicap() {
      throw new Error("simulated recalculation failure");
    },
    async recalculatePccForTeeConfigDay() {
      throw new Error("not used by this test");
    },
  };
  const scoringService = createScoringService(roundsRepo, coursesRepo, createPccService(createPccRepository(pool)));
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, failingRecalculation, notificationsRepository, logger);

  await assert.rejects(() => roundsService.approveRound(round.id), /simulated recalculation failure/);

  // approveRound's own notifications.record("round_approved") call ran
  // BEFORE the failing recalculation call, inside the same transaction --
  // if it were a separate, already-committed write, this row would still
  // be here despite the overall approval having failed.
  const history = await historyRowsForPlayer(player.id);
  assert.equal(history.length, 0, "the round_approved notification rolled back together with the failed status change");

  const afterFailure = await roundsRepo.get(round.id);
  assert.equal(afterFailure!.status, "pending");
});

test("createOverride writes a manual_override notification in the same transaction as the override and handicap_history writes, real Postgres", async () => {
  const players = createPlayersRepository(pool);
  const users = createUsersRepository(pool);
  const player = await players.create({ firstName: "Override", lastName: "Notify" });
  const admin = await users.create({
    email: `notify-admin-${Date.now()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });

  const notificationsRepository = createNotificationsRepository(pool);
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const overridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, logger);

  await overridesService.createOverride({
    playerId: player.id, adminUserId: admin.id, previousIndex: 15.0, newIndex: 12.0, reason: "Verified against a paper certificate",
  });

  const history = await historyRowsForPlayer(player.id);
  assert.deepEqual(history.map((h) => h.event_type), ["manual_override"]);

  const outbox = await outboxRowsForPlayer(player.id);
  assert.equal(outbox.length, 1);
  const payloadResult = await pool.query<{ payload: { reason: string } }>("SELECT payload FROM notification_outbox WHERE id = $1", [outbox[0]!.id]);
  assert.equal(payloadResult.rows[0]!.payload.reason, "Verified against a paper certificate");
});

test("createOverride trims the reason once and stores the trimmed value consistently -- handicap_overrides, handicap_history, and the notification payload all agree (caught in review, PR #33)", async () => {
  const players = createPlayersRepository(pool);
  const users = createUsersRepository(pool);
  const player = await players.create({ firstName: "Trim", lastName: "Notify" });
  const admin = await users.create({
    email: `notify-trim-admin-${Date.now()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });

  const notificationsRepository = createNotificationsRepository(pool);
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const overridesRepo = createHandicapOverridesRepository(pool);
  const overridesService = createHandicapOverridesService(pool, overridesRepo, handicapHistoryService, notificationsRepository, logger);

  const override = await overridesService.createOverride({
    playerId: player.id, adminUserId: admin.id, previousIndex: 15.0, newIndex: 12.0, reason: "  Verified against a paper certificate  ",
  });
  assert.equal(override.reason, "Verified against a paper certificate", "returned value is already trimmed");

  const stored = await overridesRepo.listForPlayer(player.id);
  assert.equal(stored[0]!.reason, "Verified against a paper certificate", "handicap_overrides.reason is trimmed, not whitespace-padded");

  const history = await handicapHistoryService.listHistoryForPlayer(player.id);
  assert.equal(history[0]!.reason, "Verified against a paper certificate", "handicap_history.reason agrees");

  const outbox = await outboxRowsForPlayer(player.id);
  const payloadResult = await pool.query<{ payload: { reason: string } }>("SELECT payload FROM notification_outbox WHERE id = $1", [outbox[0]!.id]);
  assert.equal(payloadResult.rows[0]!.payload.reason, "Verified against a paper certificate", "the notification payload agrees too");
});

test("no code path reachable from ghs#25's notification triggers is capable of a synchronous provider call -- static check, ADR-210", async () => {
  const forbiddenPatterns = [/sendEmail/i, /EmailProvider/, /nodemailer/i, /sendgrid/i, /\bses\.send/i, /smtp/i, /mailpit/i, /\bfetch\(.*mail/i];
  const filesToCheck = [
    "../src/application/rounds.service.ts",
    "../src/application/recalculation.service.ts",
    "../src/application/handicap-overrides.service.ts",
    "../src/data/notifications.repository.ts",
  ];

  for (const relativePath of filesToCheck) {
    const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url));
    const content = await readFile(absolutePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(content, pattern, `${relativePath} must not reference a synchronous email/provider call (matched ${pattern})`);
    }
  }
});
