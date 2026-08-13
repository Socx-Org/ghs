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
import type { NotificationsRepository } from "../src/data/notifications.repository.ts";
import type { RecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createAuthService } from "../src/application/auth.service.ts";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createMfaService } from "../src/application/mfa.service.ts";
import { createAdminUsersService } from "../src/application/admin-users.service.ts";
import { randomBytes } from "node:crypto";
import type { AuthConfig } from "../src/config.ts";

// ghs#25/ghs#39's own Automated Test Requirements, verified here against
// a real database:
// - an outbox row is created in the SAME transaction as the business
//   event (not just "a row exists afterward")
// - no code path in this issue is capable of a synchronous provider call
// - amendment-reopen writes no outbox row
// - a no-op recalculation (no actual index change) writes no notification
// - a player with no linked user account is skipped, not errored (ghs#39)

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

// Every real notification recipient is a user (ghs#39) -- this helper
// creates a real, linked player+user pair so notifications actually fire,
// instead of a bare player (which has no linked user, and is therefore
// deliberately skipped -- see the dedicated "no linked user" test below).
async function createPlayerWithUser(firstName: string, lastName: string): Promise<{ playerId: string; userId: string }> {
  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const user = await users.create({
    email: `${firstName}.${lastName}.${Date.now()}.${Math.random()}@example.com`.toLowerCase(),
    passwordHash: "irrelevant-for-this-test",
    role: "player",
    status: "active",
  });
  const player = await players.create({ userId: user.id, firstName, lastName });
  return { playerId: player.id, userId: user.id };
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
  const players = createPlayersRepository(pool);
  const recalculationOrchestrator = createRecalculationOrchestrator(pool, roundsRepo, handicapHistoryService, pccService, notificationsRepository, players, logger);
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, players, logger);
  return { roundsRepo, coursesRepo, handicapHistoryService, notificationsRepository, players, recalculationOrchestrator, roundsService };
}

interface OutboxRow {
  id: string;
  notification_history_id: string;
  event_type: string;
  status: string;
}

async function outboxRowsForUser(userId: string): Promise<OutboxRow[]> {
  const result = await pool.query<OutboxRow>(
    `SELECT o.id, o.notification_history_id, o.event_type, o.status
     FROM notification_outbox o
     JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.user_id = $1
     ORDER BY o.created_at`,
    [userId],
  );
  return result.rows;
}

async function historyRowsForUser(userId: string): Promise<Array<{ event_type: string }>> {
  const result = await pool.query<{ event_type: string }>(
    "SELECT event_type FROM notification_history WHERE user_id = $1 ORDER BY created_at",
    [userId],
  );
  return result.rows;
}

test("createRound writes notification_history and its child notification_outbox row, both in the same transaction as the round itself, real Postgres", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const { playerId, userId } = await createPlayerWithUser("Submit", "Notify");
  const { roundsService } = buildServices();

  const round = await roundsService.createRound({ playerId, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  const history = await historyRowsForUser(userId);
  assert.deepEqual(history.map((h) => h.event_type), ["round_submitted"]);

  const outbox = await outboxRowsForUser(userId);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]!.event_type, "round_submitted");
  // Never transitions out of 'pending' -- there is no worker in this
  // issue's scope to claim or send it (ADR-210's own delivery machinery
  // is ghs#42, a later phase).
  assert.equal(outbox[0]!.status, "pending");

  const outboxRow = await pool.query("SELECT payload FROM notification_outbox WHERE id = $1", [outbox[0]!.id]);
  assert.equal(outboxRow.rows[0]!.payload.roundId, round.id);
});

test("createRound skips the notification (does not error) for a player with no linked user account, real Postgres (ghs#39)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "No", lastName: "Login" }); // no userId -- deliberately unlinked
  const { roundsService } = buildServices();

  const round = await roundsService.createRound({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  assert.ok(round.id, "the round itself is still created normally");
  const historyCount = await pool.query("SELECT COUNT(*) FROM notification_history");
  assert.equal(Number(historyCount.rows[0]!.count), 0, "no email address exists anywhere for a player with no linked user account");
});

test("an invalid event_type is rejected at the database level on both notification_history and notification_outbox, not only by the fixed NotificationEventType union (caught in review, PR #33)", async () => {
  const { userId } = await createPlayerWithUser("Invalid", "EventType");

  await assert.rejects(() =>
    pool.query("INSERT INTO notification_history (user_id, event_type, payload) VALUES ($1, 'not_a_real_event', '{}'::jsonb)", [userId]),
  );

  const historyResult = await pool.query<{ id: string }>(
    "INSERT INTO notification_history (user_id, event_type, payload) VALUES ($1, 'round_submitted', '{}'::jsonb) RETURNING id",
    [userId],
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
  const { playerId, userId } = await createPlayerWithUser("Approve", "Notify");
  const { roundsRepo, roundsService } = buildServices();

  // Two other approved rounds so this one's approval reaches eligibility (3 minimum).
  await createApprovedRound(playerId, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(playerId, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);

  const round = await roundsRepo.create({ playerId, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round.id, { holeNumber: 1, strokes: 4, netDoubleBogeyAdjusted: 4 });

  await roundsService.approveRound(round.id);

  // round_submitted never fired for this round (it was inserted directly
  // via the repository, bypassing roundsService.createRound) -- only the
  // two events approveRound itself is responsible for.
  const history = await historyRowsForUser(userId);
  assert.deepEqual(history.map((h) => h.event_type).sort(), ["handicap_changed", "round_approved"]);

  const outbox = await outboxRowsForUser(userId);
  assert.equal(outbox.length, 2, "both notification_history rows have their own outbox row -- not shared, not merged");
});

test("rejectRound writes round_rejected with the reason even when there's no differential to recalculate, real Postgres", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const { playerId, userId } = await createPlayerWithUser("Reject", "Notify");
  const { roundsRepo, roundsService } = buildServices();

  const round = await roundsRepo.create({ playerId, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsService.rejectRound(round.id, "Illegible scorecard");

  const history = await historyRowsForUser(userId);
  assert.deepEqual(history.map((h) => h.event_type), ["round_rejected"]);

  const outboxResult = await pool.query<{ payload: { reason: string } }>(
    `SELECT o.payload FROM notification_outbox o
     JOIN notification_history h ON h.id = o.notification_history_id
     WHERE h.user_id = $1`,
    [userId],
  );
  assert.equal(outboxResult.rows[0]!.payload.reason, "Illegible scorecard");
});

test("reopenForAmendment writes neither a notification_history row nor an outbox row -- not even indirectly through its own recalculation (ghs#25's own acceptance criterion, real Postgres)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const { playerId, userId } = await createPlayerWithUser("Reopen", "Silent");
  const { roundsService } = buildServices();

  await createApprovedRound(playerId, teeConfigurationId, "2026-05-01T09:00:00.000Z", 20.0);
  await createApprovedRound(playerId, teeConfigurationId, "2026-05-02T09:00:00.000Z", 20.0);
  const roundId = await createApprovedRound(playerId, teeConfigurationId, "2026-05-03T09:00:00.000Z", 10.0);

  await pool.query("DELETE FROM notification_history"); // discard anything from setup above (there is none, but keeps this test independent of setup changes)

  const result = await roundsService.reopenForAmendment(roundId, "Scorecard under review");
  assert.equal(result.round!.status, "amending");
  assert.ok(result.recalculation, "the recalculation itself genuinely ran (retraction)");

  const history = await historyRowsForUser(userId);
  assert.equal(history.length, 0, "no notification_history row at all for reopen, including its own recalculation side effect");

  const outboxCount = await pool.query("SELECT COUNT(*) FROM notification_outbox");
  assert.equal(Number(outboxCount.rows[0]!.count), 0);
});

test("a no-op recalculation (no actual index change) writes no notification -- matches ghs#21's change-only history policy, real Postgres", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const { playerId, userId } = await createPlayerWithUser("NoOp", "Notify");
  const { recalculationOrchestrator } = buildServices();

  await createApprovedRound(playerId, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(playerId, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);
  await createApprovedRound(playerId, teeConfigurationId, "2026-05-03T09:00:00.000Z", 14.0);

  const first = await recalculationOrchestrator.recalculatePlayerHandicap(playerId, "round_approved");
  assert.equal(first.status, "eligible");
  assert.ok(first.historyRecordId);

  // Nothing about the player's approved rounds changed -- recalculating
  // again from the exact same inputs is a genuine no-op.
  const second = await recalculationOrchestrator.recalculatePlayerHandicap(playerId, "round_approved");
  assert.equal(second.status, "eligible");
  assert.equal(second.historyRecordId, null);

  const history = await historyRowsForUser(userId);
  assert.deepEqual(history.map((h) => h.event_type), ["handicap_changed"], "exactly one notification -- from the first, real change -- not two");
});

test("the state change and its notification writes roll back together on failure -- proves they share one real transaction, not two independent writes (ghs#25/ADR-210 point 1, real Postgres)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const { playerId, userId } = await createPlayerWithUser("Atomic", "Notify");
  const { roundsRepo, coursesRepo, notificationsRepository, players } = buildServices();

  const round = await roundsRepo.create({ playerId, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
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
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, failingRecalculation, notificationsRepository, players, logger);

  await assert.rejects(() => roundsService.approveRound(round.id), /simulated recalculation failure/);

  // approveRound's own notifications.record("round_approved") call ran
  // BEFORE the failing recalculation call, inside the same transaction --
  // if it were a separate, already-committed write, this row would still
  // be here despite the overall approval having failed.
  const history = await historyRowsForUser(userId);
  assert.equal(history.length, 0, "the round_approved notification rolled back together with the failed status change");

  const afterFailure = await roundsRepo.get(round.id);
  assert.equal(afterFailure!.status, "pending");
});

test("createOverride writes a manual_override notification in the same transaction as the override and handicap_history writes, real Postgres", async () => {
  const { playerId, userId } = await createPlayerWithUser("Override", "Notify");
  const users = createUsersRepository(pool);
  const admin = await users.create({
    email: `notify-admin-${Date.now()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });

  const notificationsRepository = createNotificationsRepository(pool);
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const players = createPlayersRepository(pool);
  const overridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);

  await overridesService.createOverride({
    playerId, adminUserId: admin.id, previousIndex: 15.0, newIndex: 12.0, reason: "Verified against a paper certificate",
  });

  const history = await historyRowsForUser(userId);
  assert.deepEqual(history.map((h) => h.event_type), ["manual_override"]);

  const outbox = await outboxRowsForUser(userId);
  assert.equal(outbox.length, 1);
  const payloadResult = await pool.query<{ payload: { reason: string } }>("SELECT payload FROM notification_outbox WHERE id = $1", [outbox[0]!.id]);
  assert.equal(payloadResult.rows[0]!.payload.reason, "Verified against a paper certificate");
});

test("createOverride trims the reason once and stores the trimmed value consistently -- handicap_overrides, handicap_history, and the notification payload all agree (caught in review, PR #33)", async () => {
  const { playerId, userId } = await createPlayerWithUser("Trim", "Notify");
  const users = createUsersRepository(pool);
  const admin = await users.create({
    email: `notify-trim-admin-${Date.now()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });

  const notificationsRepository = createNotificationsRepository(pool);
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const players = createPlayersRepository(pool);
  const overridesRepo = createHandicapOverridesRepository(pool);
  const overridesService = createHandicapOverridesService(pool, overridesRepo, handicapHistoryService, notificationsRepository, players, logger);

  const override = await overridesService.createOverride({
    playerId, adminUserId: admin.id, previousIndex: 15.0, newIndex: 12.0, reason: "  Verified against a paper certificate  ",
  });
  assert.equal(override.reason, "Verified against a paper certificate", "returned value is already trimmed");

  const stored = await overridesRepo.listForPlayer(playerId);
  assert.equal(stored[0]!.reason, "Verified against a paper certificate", "handicap_overrides.reason is trimmed, not whitespace-padded");

  const history = await handicapHistoryService.listHistoryForPlayer(playerId);
  assert.equal(history[0]!.reason, "Verified against a paper certificate", "handicap_history.reason agrees");

  const outbox = await outboxRowsForUser(userId);
  const payloadResult = await pool.query<{ payload: { reason: string } }>("SELECT payload FROM notification_outbox WHERE id = $1", [outbox[0]!.id]);
  assert.equal(payloadResult.rows[0]!.payload.reason, "Verified against a paper certificate", "the notification payload agrees too");
});

// ghs#39: the four remaining real notification paths, migrated off a
// plaintext-token-logging placeholder onto this same real outbox write
// path -- found by direct search of auth.service.ts/admin-users.
// service.ts, not assumed from the original ~9-call-site discovery.
const authConfig: AuthConfig = {
  jwtSecret: "notif-test-secret", jwtAccessExpiresInSeconds: 900, jwtRefreshExpiresInSeconds: 2_592_000,
  mfaPendingExpiresInSeconds: 300, mfaEncryptionKey: randomBytes(32),
};

// notifications is swappable per-test -- the rollback tests below inject
// one whose record() always throws, to prove the earlier real writes
// (user row, player row, token row) share the SAME transaction as the
// notification write and roll back together with it (ADR-210 point 1),
// not "commit the business change, then separately try to write the
// outbox".
function buildAuthServices(notifications: NotificationsRepository) {
  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const authService = createAuthService({
    pool, logger, authProvider, users, players, activationTokens, passwordResetTokens,
    mfa: mfaRepo, mfaVerifier: mfaService, notifications,
  });
  const adminUsersService = createAdminUsersService(pool, logger, users, players, activationTokens, notifications);
  return { users, players, activationTokens, passwordResetTokens, authService, adminUsersService };
}

const failingNotifications: NotificationsRepository = {
  async record() {
    throw new Error("simulated notification failure");
  },
  async listForUser() {
    return [];
  },
};

test("register writes an account_activation notification, real Postgres (ghs#39)", async () => {
  const { authService } = buildAuthServices(createNotificationsRepository(pool));

  const { userId } = await authService.register({ email: "activation-test@example.com", password: "correct-horse-battery", firstName: "A", lastName: "B" });

  const history = await historyRowsForUser(userId);
  assert.deepEqual(history.map((h) => h.event_type), ["account_activation"]);

  const outbox = await outboxRowsForUser(userId);
  assert.equal(outbox.length, 1);
  const payload = await pool.query<{ payload: { token: string; email: string } }>("SELECT payload FROM notification_outbox WHERE id = $1", [outbox[0]!.id]);
  assert.ok(payload.rows[0]!.payload.token, "the raw token is present in the durable payload -- the worker needs it to build the real activation email");
  assert.equal(payload.rows[0]!.payload.email, "activation-test@example.com");
});

test("register: rolls back the created user and player together with a failing notification write, real Postgres (ghs#39/ADR-210 point 1)", async () => {
  const { authService, users } = buildAuthServices(failingNotifications);

  await assert.rejects(
    () => authService.register({ email: "rollback-register@example.com", password: "correct-horse-battery", firstName: "R", lastName: "B" }),
    /simulated notification failure/,
  );

  assert.equal(await users.findByEmail("rollback-register@example.com"), null, "the user row must not survive when its own notification write failed in the same transaction");
});

async function validActivationTokenCount(userId: string): Promise<number> {
  const result = await pool.query(
    "SELECT COUNT(*) FROM account_activation_tokens WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()",
    [userId],
  );
  return Number(result.rows[0]!.count);
}

test("resendActivation writes an account_activation_resend notification in the same transaction as the new token, real Postgres (ghs#39)", async () => {
  const services = buildAuthServices(createNotificationsRepository(pool));
  const created = await services.adminUsersService.adminCreateUser({
    email: "resend-me@example.com", password: "irrelevant-pw-1", role: "player", firstName: "Resend", lastName: "Me", autoActivate: false,
  });

  await services.authService.resendActivation("resend-me@example.com");

  const history = await historyRowsForUser(created.userId);
  assert.deepEqual(history.map((h) => h.event_type).sort(), ["account_activation_admin_invite", "account_activation_resend"]);

  assert.equal(await validActivationTokenCount(created.userId), 2, "the original invite token and the new resent token are both still valid");
});

test("resendActivation: rolls back the new activation token together with a failing notification write, real Postgres (ghs#39/ADR-210 point 1)", async () => {
  const setup = buildAuthServices(createNotificationsRepository(pool));
  const created = await setup.adminUsersService.adminCreateUser({
    email: "resend-rollback@example.com", password: "irrelevant-pw-1", role: "player", firstName: "Resend", lastName: "Rollback", autoActivate: false,
  });
  const countBefore = await validActivationTokenCount(created.userId);

  const { authService } = buildAuthServices(failingNotifications);
  await assert.rejects(() => authService.resendActivation("resend-rollback@example.com"), /simulated notification failure/);

  const countAfter = await validActivationTokenCount(created.userId);
  assert.equal(countAfter, countBefore, "the new activation token must not survive when its own notification write failed in the same transaction");
});

test("requestPasswordReset: rolls back the new reset token together with a failing notification write, real Postgres (ghs#39/ADR-210 point 1)", async () => {
  const setup = buildAuthServices(createNotificationsRepository(pool));
  const created = await setup.adminUsersService.adminCreateUser({
    email: "reset-rollback@example.com", password: "irrelevant-pw-1", role: "player", firstName: "Reset", lastName: "Rollback", autoActivate: true,
  });

  const { authService } = buildAuthServices(failingNotifications);
  await assert.rejects(() => authService.requestPasswordReset("reset-rollback@example.com"), /simulated notification failure/);

  const history = await historyRowsForUser(created.userId);
  assert.equal(history.filter((h) => h.event_type === "password_reset").length, 0, "no password_reset history row when the notification write in the same transaction failed");
});

test("adminCreateUser (autoActivate false): rolls back the created user and player together with a failing notification write, real Postgres (ghs#39/ADR-210 point 1)", async () => {
  const { adminUsersService, users } = buildAuthServices(failingNotifications);

  await assert.rejects(
    () => adminUsersService.adminCreateUser({
      email: "admin-invite-rollback@example.com", password: "irrelevant-pw-1", role: "player", firstName: "Invite", lastName: "Rollback", autoActivate: false,
    }),
    /simulated notification failure/,
  );

  assert.equal(await users.findByEmail("admin-invite-rollback@example.com"), null, "the admin-created user row must not survive when its own notification write failed in the same transaction");
});

test("no code path reachable from ghs#25/ghs#39's notification triggers is capable of a synchronous provider call -- static check, ADR-210", async () => {
  const forbiddenPatterns = [/sendEmail/i, /EmailProvider/, /nodemailer/i, /sendgrid/i, /\bses\.send/i, /smtp/i, /mailpit/i, /\bfetch\(.*mail/i];
  const filesToCheck = [
    "../src/application/rounds.service.ts",
    "../src/application/recalculation.service.ts",
    "../src/application/handicap-overrides.service.ts",
    "../src/application/auth.service.ts",
    "../src/application/admin-users.service.ts",
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

test("no raw activation/reset token is ever logged (SEC-010) -- static check that the removed logDeliveryPlaceholder placeholder hasn't crept back", async () => {
  const filesToCheck = ["../src/application/auth.service.ts", "../src/application/admin-users.service.ts"];
  for (const relativePath of filesToCheck) {
    const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url));
    const content = await readFile(absolutePath, "utf8");
    assert.doesNotMatch(content, /logger\.(info|debug|warn|error)\([^)]*token/is, `${relativePath} must never log a raw token -- it belongs only in the notification outbox payload`);
  }
});
