import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createSystemSettingsRepository } from "../src/data/system-settings.repository.ts";
import { createPresenceSnapshotsRepository } from "../src/data/presence-snapshots.repository.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createHandicapHistoryRepository } from "../src/data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "../src/application/handicap-history.service.ts";
import { createDashboardService } from "../src/application/dashboard.service.ts";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import { createNotificationsRepository } from "../src/data/notifications.repository.ts";
import { createRoundsService } from "../src/application/rounds.service.ts";
import { createHandicapOverridesRepository } from "../src/data/handicap-overrides.repository.ts";
import { createHandicapOverridesService } from "../src/application/handicap-overrides.service.ts";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import { createAuthService } from "../src/application/auth.service.ts";
import { createMfaService } from "../src/application/mfa.service.ts";
import { createAdminUsersService } from "../src/application/admin-users.service.ts";
import { createClubsService } from "../src/application/clubs.service.ts";
import { createCoursesService } from "../src/application/courses.service.ts";
import { createSystemSettingsService } from "../src/application/system-settings.service.ts";
import { createApp } from "../src/interface/http/app.ts";
import type { AuthConfig } from "../src/config.ts";
import type { RecalculationOrchestrator } from "../src/application/recalculation.service.ts";
import type { RoundWorkflowResult } from "../src/application/rounds.service.ts";

// Issue 23 (Round Approval, Rejection & Amendment Workflow): the
// acceptance-criteria tests that need a real orchestrator and a real
// database -- the confirmed legacy bug fix (reject/delete must actually
// recalculate, not just log), the amendment lifecycle's retraction and
// re-inclusion, and the state-transition/recalculation atomicity
// guarantee. Unit-level coverage of the same methods (validation errors,
// which trigger fires, client-threading) already lives in
// rounds.service.test.ts against fakes; this file is specifically about
// behaviour that only a real Postgres transaction can prove.

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

async function createTeeConfiguration(courseRating = 72.0, slopeRating = 113, courseName = "Round Workflow Test Course"): Promise<string> {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: courseName,
    country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating, slopeRating, holes: [] }],
  });
  return course.teeConfigurations[0]!.id;
}

// Bypasses the workflow entirely -- inserts a round already 'approved'
// with a known score_differential, directly via the repository layer, so
// each test's baseline handicap state is deterministic and doesn't
// depend on real scoring/PCC computation (same pattern already
// established in recalculation.integration.test.ts).
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
  const systemSettingsService = createSystemSettingsService(createSystemSettingsRepository(pool));
  const recalculationOrchestrator = createRecalculationOrchestrator(pool, roundsRepo, handicapHistoryService, pccService, notificationsRepository, players, logger);
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, players, systemSettingsService, logger);
  return { roundsRepo, coursesRepo, handicapHistoryService, notificationsRepository, players, systemSettingsService, recalculationOrchestrator, roundsService };
}

test("rejectRound recalculates a previously-approved-then-reopened round -- the confirmed legacy bug ghs#23 fixes: legacy only logged 'recalculation requested' here, it never actually recalculated", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Reject", lastName: "Regression" });
  const { roundsService, recalculationOrchestrator, handicapHistoryService } = buildServices();

  const lowDifferentialRoundId = await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-03T09:00:00.000Z", 14.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-04T09:00:00.000Z", 20.0);

  // Baseline, as if all 4 had gone through real approvals: {10,12,14,20},
  // 4 scores -> lowest 1 used (10), adjustment -1 -> (10-1)*0.96 = 8.64 -> 8.6.
  const baseline = await recalculationOrchestrator.recalculatePlayerHandicap(player.id, "round_approved");
  assert.equal(baseline.status, "eligible");
  assert.equal(baseline.handicapIndex, 8.6);

  // The round with the lowest differential is reopened for amendment
  // (retracting it) and then rejected instead of re-approved -- the exact
  // legacy scenario this issue's bug fix targets.
  await roundsService.reopenForAmendment(lowDifferentialRoundId, "Scorecard under review");
  const result = await roundsService.rejectRound(lowDifferentialRoundId, "Scorecard dispute upheld -- round discarded");

  assert.equal(result.round!.status, "rejected");
  assert.ok(result.recalculation, "rejecting a round that carried a real differential must actually recalculate, not just log");
  assert.equal(result.recalculation!.status, "eligible");

  // Remaining {12,14,20}: 3 scores -> lowest 1 (12), adjustment -2 ->
  // (12-2)*0.96 = 9.6. Different from the 8.6 baseline -- proof the
  // rejection's recalculation genuinely ran and genuinely excluded the
  // rejected round, not merely returned a status.
  assert.equal(result.recalculation!.handicapIndex, 9.6);
  const current = await handicapHistoryService.getCurrentIndex(player.id);
  assert.equal(current!.handicapIndex, 9.6);
});

test("rejectRound skips recalculation for a round that never had a differential -- nothing to retract, real database proof", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Never", lastName: "Scored" });
  const { roundsRepo, roundsService } = buildServices();

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.setStatus(round.id, "pending");
  const result = await roundsService.rejectRound(round.id, "Never submitted a scorecard");

  assert.equal(result.round!.status, "rejected");
  assert.equal(result.recalculation, null);
});

test("addHoleScore's editable-status check is genuinely atomic with the write -- a concurrent holder of the round's row lock blocks it until released (ghs#58, review fix)", async () => {
  // Real hole metadata, unlike createTeeConfiguration()'s bare
  // holes: [] -- this test goes through roundsService.addHoleScore (not
  // the repository directly), which computes net_double_bogey_adjusted
  // via scoring.computeHoleAdjustment and needs a real hole 1 to do so.
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Round Workflow Lock Test Course",
    country: "ES",
    teeConfigurations: [{
      name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113,
      holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
    }],
  });
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Locked", lastName: "Hole" });
  const { roundsRepo, roundsService } = buildServices();

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  // Manually hold exactly the row lock addHoleScore's own getForUpdate
  // call needs to acquire -- the same real SQL that method runs.
  const holdingClient = await pool.connect();
  await holdingClient.query("BEGIN");
  await holdingClient.query("SELECT id FROM rounds WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [round.id]);

  let completed = false;
  const addHoleScorePromise = roundsService
    .addHoleScore(round.id, { holeNumber: 1, strokes: 4 })
    .then((result) => {
      completed = true;
      return result;
    });

  // Give it every real chance to run if it were (wrongly) not actually
  // blocked -- if the status check and insert still ran against the
  // unlocked pool (the pre-fix behaviour), this would complete well
  // within this window.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(completed, false, "still blocked -- the row lock is real, not just a status check against a stale snapshot");

  await holdingClient.query("COMMIT");
  holdingClient.release();

  const holeScore = await addHoleScorePromise;
  assert.equal(holeScore.holeNumber, 1, "proceeds correctly, using a fresh locked read, once the held lock is released");
});

test("ghs#193: addHoleScore succeeds on a pending round against a real database, and immediately rescores it -- verified by deliberately reverting the fix and confirming this fails first", async () => {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Pending Edit Rescore Test Course",
    country: "ES",
    teeConfigurations: [{
      name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113,
      holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
    }],
  });
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Pending", lastName: "Editor" });
  const { roundsRepo, roundsService } = buildServices();

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsService.addHoleScore(round.id, { holeNumber: 1, strokes: 4 });
  await roundsRepo.setStatus(round.id, "pending");

  const holeScore = await roundsService.addHoleScore(round.id, { holeNumber: 1, strokes: 9 });
  assert.equal(holeScore.strokes, 9, "editing a hole score on a pending round succeeds against a real database, not just a fake");

  const reloaded = await roundsRepo.get(round.id);
  assert.equal(reloaded!.grossScore, 9, "the round's own cached gross score reflects the correction immediately -- rescored as part of the edit, not deferred to the next resubmission/approval");
});

test("submitForReview rescores AFTER its own locked transition commits, not before it opens -- a hole score that lands while submission is blocked on the row lock is still reflected in the final persisted score (ghs#168 review fix)", async () => {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Submission Rescore Race Test Course",
    country: "ES",
    teeConfigurations: [{
      name: "White", holeCount: 18, courseRating: 72.0, slopeRating: 113,
      holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
    }],
  });
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Race", lastName: "Regression" });
  const { roundsRepo, roundsService } = buildServices();

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsService.addHoleScore(round.id, { holeNumber: 1, strokes: 4 });

  // Same technique as the lock test directly above -- hold exactly the
  // row lock submitForReview's own runWorkflowTransition needs, forcing
  // it to block right at that point (its own pre-check, upstream of the
  // lock, already ran and found the round complete/editable).
  const holdingClient = await pool.connect();
  await holdingClient.query("BEGIN");
  await holdingClient.query("SELECT id FROM rounds WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [round.id]);

  let completed = false;
  const submitPromise = roundsService.submitForReview(round.id, "player").then((result) => {
    completed = true;
    return result;
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(completed, false, "blocked on the row lock, exactly like addHoleScore's own lock above");

  // Simulates a hole-score correction landing in that exact window --
  // direct SQL rather than roundsService.addHoleScore since that method
  // needs the very same row lock this test is deliberately holding; the
  // real, lock-protected write path is already proven above. What
  // matters here is only that hole_scores changes while submission is
  // blocked, before the lock is released.
  await pool.query("UPDATE hole_scores SET strokes = 9, net_double_bogey_adjusted = 9 WHERE round_id = $1 AND hole_number = 1", [round.id]);

  await holdingClient.query("COMMIT");
  holdingClient.release();

  const result = await submitPromise;
  assert.equal(result.round!.status, "pending");
  // The bug this regresses: the pre-fix code rescored BEFORE attempting
  // this lock, so it would have persisted grossScore=4 (the value hole_
  // scores held at the moment submission started) despite hole_scores
  // now genuinely holding 9 -- a round silently 'pending' with a score
  // that disagreed with its own hole-by-hole detail, exactly the
  // unreliability ghs#168 exists to remove from the Daily PCC screen's
  // data source.
  assert.equal(result.round!.grossScore, 9, "reflects the hole score as it stood once the lock was actually available, not a stale pre-lock read");
});

test("RoundsRepository.addHoleScore upserts against the real ON CONFLICT DO UPDATE, not a second row or a unique-violation (ghs#92)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Upsert", lastName: "Test" });
  const rounds = createRoundsRepository(pool);
  const round = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  await rounds.addHoleScore(round.id, { holeNumber: 5, strokes: 6, putts: 2 });
  await rounds.addHoleScore(round.id, { holeNumber: 5, strokes: 4, putts: 1 });

  const reloaded = await rounds.get(round.id);
  assert.equal(reloaded!.holeScores.length, 1, "still exactly one row for hole 5 in the real database, not two");
  assert.equal(reloaded!.holeScores[0]!.strokes, 4);
  assert.equal(reloaded!.holeScores[0]!.putts, 1);
});

test("RoundsRepository.addHoleScore's real ON CONFLICT DO UPDATE preserves omitted fields, real database (review finding, PR #93)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Preserve", lastName: "Test" });
  const rounds = createRoundsRepository(pool);
  const round = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  await rounds.addHoleScore(round.id, { holeNumber: 5, strokes: 6, putts: 3, gir: true, inSand: true, penalties: 1 });
  // A correction that only touches strokes -- everything else omitted,
  // exactly what a mobile "fix my stroke count" affordance would send.
  await rounds.addHoleScore(round.id, { holeNumber: 5, strokes: 4 });

  const reloaded = await rounds.get(round.id);
  const hole = reloaded!.holeScores[0]!;
  assert.equal(hole.strokes, 4, "the field actually corrected");
  assert.equal(hole.putts, 3, "preserved by the real COALESCE, not reset to null");
  assert.equal(hole.gir, true, "preserved, not reset to false");
  assert.equal(hole.inSand, true, "preserved, not reset to false");
  assert.equal(hole.penalties, 1, "preserved, not reset to 0");

  // An explicit false/0 is still honoured, distinct from omission.
  await rounds.addHoleScore(round.id, { holeNumber: 5, strokes: 4, gir: false, penalties: 0 });
  const afterExplicitClear = await rounds.get(round.id);
  const clearedHole = afterExplicitClear!.holeScores[0]!;
  assert.equal(clearedHole.gir, false, "an explicit false must still take effect");
  assert.equal(clearedHole.penalties, 0, "an explicit 0 must still take effect");
  assert.equal(clearedHole.putts, 3, "still untouched -- this correction never mentioned putts");
});

test("deleteRound soft-deletes and recalculates when the round had a differential, real database proof", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Delete", lastName: "Recalc" });
  const { roundsRepo, roundsService, recalculationOrchestrator, handicapHistoryService } = buildServices();

  const toDeleteId = await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-03T09:00:00.000Z", 14.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-04T09:00:00.000Z", 20.0);

  const baseline = await recalculationOrchestrator.recalculatePlayerHandicap(player.id, "round_approved");
  assert.equal(baseline.handicapIndex, 8.6); // {10,12,14,20} -> lowest 1 (10), adj -1 -> 8.6

  const result = await roundsService.deleteRound(toDeleteId, "admin");

  assert.equal(result.round, null, "a soft-deleted round is invisible to the same filtered read every other round uses");
  assert.ok(result.recalculation);
  assert.equal(result.recalculation!.handicapIndex, 9.6); // remaining {12,14,20} -> 9.6, same as the reject case above
  const current = await handicapHistoryService.getCurrentIndex(player.id);
  assert.equal(current!.handicapIndex, 9.6);

  // Genuinely gone, not just excluded from the calculation.
  assert.equal(await roundsRepo.get(toDeleteId), null);
});

// ghs#147 (platform-owner decision): a player may delete their own
// round while it's still editable (draft/rejected/amending), but never
// an already-approved one -- only admin/super_admin keep the
// unrestricted-status behaviour proven above.
test("deleteRound (ghs#147): a player caller can delete their own editable-status round, real database proof", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "SelfDelete", lastName: "Editable" });
  const { roundsRepo, roundsService } = buildServices();

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  assert.equal(round.status, "draft");

  const result = await roundsService.deleteRound(round.id, "player");

  assert.equal(result.round, null);
  assert.equal(result.recalculation, null, "a draft round never had a differential -- nothing to recalculate");
  assert.equal(await roundsRepo.get(round.id), null, "genuinely gone");
});

test("deleteRound (ghs#147): a player caller cannot delete their own round once it's no longer editable (pending/approved)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "SelfDelete", lastName: "Blocked" });
  const { roundsRepo, roundsService } = buildServices();

  const pendingRound = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.setStatus(pendingRound.id, "pending");
  await assert.rejects(
    () => roundsService.deleteRound(pendingRound.id, "player"),
    /cannot delete a round in status 'pending'/,
  );

  const approvedId = await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);
  await assert.rejects(
    () => roundsService.deleteRound(approvedId, "player"),
    /cannot delete a round in status 'approved'/,
  );

  // Genuinely untouched by either rejected attempt.
  assert.ok(await roundsRepo.get(pendingRound.id));
  assert.ok(await roundsRepo.get(approvedId));
});

// Review finding, PR #148: the check must fail closed (restricted) for
// any caller role that isn't positively confirmed as admin/super_admin
// -- not fail open (unrestricted) for anything that merely isn't
// exactly "player". An anomalous/unexpected role value must never be
// treated as admin-equivalent.
test("deleteRound (ghs#147 review fix): an unexpected/malformed callerRole value is still treated as restricted, not unrestricted", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "SelfDelete", lastName: "Anomalous" });
  const { roundsRepo, roundsService } = buildServices();

  const approvedId = await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 12.0);
  // @ts-expect-error -- deliberately an unexpected value, proving the
  // runtime fail-closed behaviour, not just the type system.
  await assert.rejects(() => roundsService.deleteRound(approvedId, "not-a-real-role"), /cannot delete a round in status 'approved'/);

  assert.ok(await roundsRepo.get(approvedId), "genuinely untouched -- the anomalous role must not have been treated as admin-equivalent");
});

test("HTTP DELETE /rounds/:id (ghs#147): a player deletes their own draft round directly (200), the same route admin uses", async () => {
  const authConfig: AuthConfig = {
    jwtSecret: "round-workflow-147-test-secret",
    jwtAccessExpiresInSeconds: 900,
    jwtRefreshExpiresInSeconds: 2_592_000,
    mfaPendingExpiresInSeconds: 300,
    mfaEncryptionKey: randomBytes(32),
  };

  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const clubsRepo = createClubsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const settingsRepo = createSystemSettingsRepository(pool);
  const { roundsRepo, roundsService, notificationsRepository, recalculationOrchestrator } = buildServices();

  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const systemSettingsService = createSystemSettingsService(settingsRepo);
  const authService = createAuthService({
    pool, logger, authProvider, users, players, activationTokens, passwordResetTokens,
    mfa: mfaRepo, mfaVerifier: mfaService, notifications: notificationsRepository,
  });
  const clubsService = createClubsService(clubsRepo, logger);
  const coursesService = createCoursesService(coursesRepo, logger);
  const adminUsersService = createAdminUsersService(pool, logger, users, players, activationTokens, notificationsRepository);
  const pccService = createPccService(createPccRepository(pool));
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, users, coursesRepo, createPresenceSnapshotsRepository(pool), systemSettingsService, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService, playersRepository: players, authProvider,
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const teeConfigurationId = await createTeeConfiguration();
    const playerUser = await adminUsersService.adminCreateUser({
      email: "self-delete-player@example.com", password: "player-pw-1", role: "player",
      firstName: "SelfDelete", lastName: "Http", autoActivate: true,
    });
    const playerRecord = await players.findByUserId(playerUser.userId);
    const login = await authService.login("self-delete-player@example.com", "player-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");
    const asPlayer = { Authorization: `Bearer ${login.tokens.accessToken}` };

    const round = await roundsRepo.create({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

    const response = await fetch(`${baseUrl}/api/v1/rounds/${round.id}`, { method: "DELETE", headers: asPlayer });
    assert.equal(response.status, 200);
    const result = await response.json() as RoundWorkflowResult;
    assert.equal(result.round, null);
    assert.equal(await roundsRepo.get(round.id), null, "genuinely gone");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("amendment lifecycle end-to-end: reopen retracts before any correction, re-approval re-includes the corrected differential (ghs#23, platform-owner-approved design)", async () => {
  const teeConfigurationId = await createTeeConfiguration(72.0, 113); // 113/113 multiplier = 1, differential = adjustedGross - 72 - pcc(0)
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Amend", lastName: "Lifecycle" });
  const { roundsRepo, roundsService, handicapHistoryService } = buildServices();

  // Headroom: 3 other approved rounds, high enough that removing/re-adding
  // the round under amendment never drops eligibility below the WHS
  // minimum of 3 effective differentials.
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 20.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 20.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-03T09:00:00.000Z", 20.0);

  // The round under amendment, taken through the real workflow: 18 holes
  // at 5 strokes each -> gross 90, differential (113/113)*(90-72-0) = 18.0.
  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-04T09:00:00.000Z" });
  for (let holeNumber = 1; holeNumber <= 18; holeNumber++) {
    await roundsRepo.addHoleScore(round.id, { holeNumber, strokes: 5, netDoubleBogeyAdjusted: 5 });
  }
  await roundsRepo.setStatus(round.id, "pending");

  const approved = await roundsService.approveRound(round.id);
  assert.equal(approved.round!.status, "approved");
  assert.equal(approved.round!.scoreDifferential, 18.0);
  // {20,20,20,18} -> lowest 1 (18), adjustment -1 (4 scores) -> (18-1)*0.96 = 16.32 -> 16.3.
  // Player's first-ever calculation -- no Low Handicap Index yet, so
  // neither WHS cap can trigger.
  assert.equal(approved.recalculation!.handicapIndex, 16.3);

  const reopened = await roundsService.reopenForAmendment(round.id, "Scorecard transcription error on the back nine");
  assert.equal(reopened.round!.status, "amending");
  // Retracted the instant the status changes -- remaining {20,20,20} -> 3
  // scores -> lowest 1 (20), adjustment -2 -> (20-2)*0.96 = 17.28 -> 17.2.
  // No correction has been made yet at this point.
  assert.equal(reopened.recalculation!.handicapIndex, 17.2);
  const duringAmendment = await handicapHistoryService.getCurrentIndex(player.id);
  assert.equal(duringAmendment!.handicapIndex, 17.2, "retraction happens via the status change itself, before any correction");

  // The admin corrects hole 1's score (5 -> 3 strokes) -- there's no
  // dedicated "edit an existing hole score" repository method yet (only
  // insert), so this goes straight at the row, standing in for whatever
  // UI-level correction mechanism eventually calls it.
  await pool.query("UPDATE hole_scores SET strokes = 3, net_double_bogey_adjusted = 3 WHERE round_id = $1 AND hole_number = 1", [round.id]);

  const reapproved = await roundsService.approveRound(round.id);
  assert.equal(reapproved.round!.status, "approved");
  // gross now 88 (90 - 2) -> differential 88-72 = 16.0.
  assert.equal(reapproved.round!.scoreDifferential, 16.0);
  // {20,20,20,16} -> lowest 1 (16), adjustment -1 -> (16-1)*0.96 = 14.4.
  // Low Handicap Index so far is 16.3 (the first calculation) -> soft cap
  // threshold 19.3 -- 14.4 is well under it, so still uncapped.
  assert.equal(reapproved.recalculation!.handicapIndex, 14.4);
  const final = await handicapHistoryService.getCurrentIndex(player.id);
  assert.equal(final!.handicapIndex, 14.4, "the corrected differential is back in the player's handicap after re-approval");
});

test("approveRound rolls back the status change if recalculation fails -- state transition and recalculation commit or roll back together (ghs#24 atomicity, real Postgres)", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Atomic", lastName: "Rollback" });
  const { roundsRepo, coursesRepo, notificationsRepository, systemSettingsService } = buildServices();
  const scoringService = createScoringService(roundsRepo, coursesRepo, createPccService(createPccRepository(pool)));

  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
  await roundsRepo.addHoleScore(round.id, { holeNumber: 1, strokes: 4, netDoubleBogeyAdjusted: 4 });
  await roundsRepo.setStatus(round.id, "pending");

  const failingRecalculation: RecalculationOrchestrator = {
    async recalculatePlayerHandicap() {
      throw new Error("simulated recalculation failure");
    },
    async recalculatePccForTeeConfigDay() {
      throw new Error("not used by this test");
    },
  };
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, failingRecalculation, notificationsRepository, players, systemSettingsService, logger);

  await assert.rejects(() => roundsService.approveRound(round.id), /simulated recalculation failure/);

  // setStatus ran before the failed recalculation call, inside the same
  // transaction -- it must not have committed on its own.
  const afterFailure = await roundsRepo.get(round.id);
  assert.equal(afterFailure!.status, "pending", "the status change rolled back together with the failed recalculation, not left half-applied");
});

test("HTTP: reject/reopen/delete are admin-only; invalid transitions are 409; a missing round is 404; GET /tee-configurations/:id (ghs#92)", async () => {
  const authConfig: AuthConfig = {
    jwtSecret: "round-workflow-test-secret",
    jwtAccessExpiresInSeconds: 900,
    jwtRefreshExpiresInSeconds: 2_592_000,
    mfaPendingExpiresInSeconds: 300,
    mfaEncryptionKey: randomBytes(32),
  };

  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const clubsRepo = createClubsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const settingsRepo = createSystemSettingsRepository(pool);
  const { roundsRepo, roundsService, notificationsRepository, recalculationOrchestrator } = buildServices();

  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const systemSettingsService = createSystemSettingsService(settingsRepo);
  const authService = createAuthService({
    pool, logger, authProvider, users, players, activationTokens, passwordResetTokens,
    mfa: mfaRepo, mfaVerifier: mfaService, notifications: notificationsRepository,
  });
  const clubsService = createClubsService(clubsRepo, logger);
  const coursesService = createCoursesService(coursesRepo, logger);
  const adminUsersService = createAdminUsersService(pool, logger, users, players, activationTokens, notificationsRepository);
  const pccService = createPccService(createPccRepository(pool));
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, users, coursesRepo, createPresenceSnapshotsRepository(pool), systemSettingsService, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService, playersRepository: players, authProvider,
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const teeConfigurationId = await createTeeConfiguration();

    const admin = await adminUsersService.adminCreateUser({
      email: "workflow-admin@example.com", password: "admin-pw-1", role: "admin",
      firstName: "Workflow", lastName: "Admin", autoActivate: true,
    });
    const playerUser = await adminUsersService.adminCreateUser({
      email: "workflow-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Workflow", lastName: "Player", autoActivate: true,
    });
    const playerRecord = await players.findByUserId(playerUser.userId);

    const adminLogin = await authService.login("workflow-admin@example.com", "admin-pw-1");
    const playerLogin = await authService.login("workflow-player@example.com", "player-pw-1");
    if (adminLogin.status !== "authenticated" || playerLogin.status !== "authenticated") throw new Error("unreachable");
    const adminToken = adminLogin.tokens.accessToken;
    const playerToken = playerLogin.tokens.accessToken;

    const round = await roundsRepo.create({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
    // ghs#58: a fresh round is 'draft' -- reject/reopen/delete's own
    // authorization and input-validation checks (player-403, missing-
    // reason-400) all happen before the service is ever reached, so
    // those assertions below are unaffected regardless of status. The
    // real admin reject call further down does reach the service, which
    // requires 'pending'/'amending' -- set directly here (not via
    // roundsService.submitForReview, which would fire a notification
    // this test doesn't otherwise care about).
    await roundsRepo.setStatus(round.id, "pending");

    const asPlayer = { "Content-Type": "application/json", Authorization: `Bearer ${playerToken}` };
    const asAdmin = { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };

    // A player cannot reject or reopen -- these remain real workflow
    // actions, admin-only (matching legacy's own behaviour), unaffected
    // by ghs#147.
    const playerReject = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/status`, {
      method: "PATCH", headers: asPlayer, body: JSON.stringify({ status: "rejected", rejectionReason: "x" }),
    });
    assert.equal(playerReject.status, 403);

    const playerReopen = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/status`, {
      method: "PATCH", headers: asPlayer, body: JSON.stringify({ status: "amending", reason: "x" }),
    });
    assert.equal(playerReopen.status, 403);

    // ghs#147: delete is no longer purely admin-only -- the OWNING
    // player clears the authorization gate, but this round is
    // 'pending' (not editable), so the service's own status
    // restriction rejects it with 409, not 403. A real ownership
    // boundary (a different player entirely) still gets 403 --
    // asserted separately right after.
    const playerDeleteOwnPending = await fetch(`${baseUrl}/api/v1/rounds/${round.id}`, { method: "DELETE", headers: asPlayer });
    assert.equal(playerDeleteOwnPending.status, 409, "a player cannot delete their own round once it's no longer editable");

    const otherPlayerUser = await adminUsersService.adminCreateUser({
      email: "workflow-other-player@example.com", password: "other-player-pw-1", role: "player",
      firstName: "Other", lastName: "Player", autoActivate: true,
    });
    const otherPlayerLogin = await authService.login("workflow-other-player@example.com", "other-player-pw-1");
    if (otherPlayerLogin.status !== "authenticated") throw new Error("unreachable");
    const asOtherPlayer = { "Content-Type": "application/json", Authorization: `Bearer ${otherPlayerLogin.tokens.accessToken}` };
    const otherPlayerDelete = await fetch(`${baseUrl}/api/v1/rounds/${round.id}`, { method: "DELETE", headers: asOtherPlayer });
    assert.equal(otherPlayerDelete.status, 403, "a different player entirely cannot delete someone else's round, regardless of status");

    // Admin reject without a reason is a validation error, not a silent no-op.
    const rejectNoReason = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "rejected" }),
    });
    assert.equal(rejectNoReason.status, 400);

    // Admin rejects for real.
    const rejectResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "rejected", rejectionReason: "Incomplete scorecard" }),
    });
    assert.equal(rejectResponse.status, 200);
    const rejected = await rejectResponse.json() as RoundWorkflowResult;
    assert.equal(rejected.round!.status, "rejected");

    // A rejected round cannot be reopened for amendment -- only 'approved' may.
    const reopenRejected = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "amending", reason: "x" }),
    });
    assert.equal(reopenRejected.status, 409);

    // A rejected round cannot be rejected again.
    const rejectAgain = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "rejected", rejectionReason: "again" }),
    });
    assert.equal(rejectAgain.status, 409);

    // A missing round is 404, not a 500, on both endpoints.
    const missingId = "00000000-0000-0000-0000-000000000000";
    const missingStatus = await fetch(`${baseUrl}/api/v1/rounds/${missingId}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(missingStatus.status, 404);
    const missingDelete = await fetch(`${baseUrl}/api/v1/rounds/${missingId}`, { method: "DELETE", headers: asAdmin });
    assert.equal(missingDelete.status, 404);

    // A blank rejectionReason must not shadow a real value in reason, and
    // both are trimmed before persisting (caught in review, PR #32).
    const thirdRound = await roundsRepo.create({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
    await roundsRepo.setStatus(thirdRound.id, "pending");
    const reasonFallbackResponse = await fetch(`${baseUrl}/api/v1/rounds/${thirdRound.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "rejected", rejectionReason: "", reason: "  Scorecard illegible  " }),
    });
    assert.equal(reasonFallbackResponse.status, 200);
    const reasonFallback = await reasonFallbackResponse.json() as RoundWorkflowResult;
    assert.equal(reasonFallback.round!.status, "rejected");
    assert.equal(reasonFallback.round!.rejectionReason, "Scorecard illegible", "falls back to reason when rejectionReason is blank, trimmed before persisting");

    // Admin can delete a round outright; the response's round is null
    // (soft-deleted, no longer a visible resource) but the call itself
    // succeeds.
    const secondRound = await roundsRepo.create({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-02T09:00:00.000Z" });
    const deleteResponse = await fetch(`${baseUrl}/api/v1/rounds/${secondRound.id}`, { method: "DELETE", headers: asAdmin });
    assert.equal(deleteResponse.status, 200);
    const deleted = await deleteResponse.json() as RoundWorkflowResult;
    assert.equal(deleted.round, null);

    // GET /tee-configurations/:id (ghs#92) -- unauthenticated, same
    // convention as GET /courses/GET /courses/:id, so no auth header at
    // all here, unlike every other assertion in this test.
    const teeConfigResponse = await fetch(`${baseUrl}/api/v1/tee-configurations/${teeConfigurationId}`);
    assert.equal(teeConfigResponse.status, 200);
    const teeConfig = await teeConfigResponse.json();
    assert.equal(teeConfig.id, teeConfigurationId);
    assert.ok(Array.isArray(teeConfig.holes));

    const missingTeeConfigResponse = await fetch(`${baseUrl}/api/v1/tee-configurations/00000000-0000-0000-0000-000000000000`);
    assert.equal(missingTeeConfigResponse.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("listPendingQueue (ghs#61): returns only genuinely pending rounds, across all players, oldest submission first, with the queue's own lightweight shape", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const playerA = await players.create({ firstName: "Queue", lastName: "First" });
  const playerB = await players.create({ firstName: "Queue", lastName: "Second" });
  const { roundsRepo, roundsService } = buildServices();

  // A draft round -- never submitted, must never appear in the queue.
  await roundsRepo.create({ playerId: playerA.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });

  // An already-approved round -- already decided, must never appear.
  await createApprovedRound(playerA.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 10.0);

  // Two real pending rounds, submitted in a known order (setStatus's own
  // updated_at is what listPendingQueue orders by).
  const firstSubmitted = await roundsRepo.create({ playerId: playerA.id, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
  await roundsRepo.setStatus(firstSubmitted.id, "pending");
  const secondSubmitted = await roundsRepo.create({ playerId: playerB.id, teeConfigurationId, playedAt: "2026-05-04T09:00:00.000Z" });
  await roundsRepo.setStatus(secondSubmitted.id, "pending");

  const queue = await roundsService.listPendingQueue();

  assert.equal(queue.length, 2, "only the two genuinely pending rounds appear -- not the draft, not the approved one");
  assert.deepEqual(queue.map((item) => item.id), [firstSubmitted.id, secondSubmitted.id], "oldest submission first, a real FIFO queue order");

  const first = queue[0]!;
  assert.equal(first.playerId, playerA.id);
  assert.equal(first.playerFirstName, "Queue");
  assert.equal(first.playerLastName, "First");
  assert.equal(first.teeConfigurationId, teeConfigurationId);
  assert.ok(first.courseName, "course name is present -- enough to render a queue row without a further per-round fetch");
  assert.ok(first.teeConfigurationName);
  assert.equal(first.playedAt, "2026-05-03T09:00:00.000Z");
});

// ---------------------------------------------------------------------
// ghs#100: GET /admin/rounds (general all-rounds browser, filter/
// paginate) and the admin-created-round auto-approval fast path.
// ---------------------------------------------------------------------

function buildWorkflowApp() {
  const authConfig: AuthConfig = {
    jwtSecret: "round-workflow-100-test-secret",
    jwtAccessExpiresInSeconds: 900,
    jwtRefreshExpiresInSeconds: 2_592_000,
    mfaPendingExpiresInSeconds: 300,
    mfaEncryptionKey: randomBytes(32),
  };

  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const clubsRepo = createClubsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const settingsRepo = createSystemSettingsRepository(pool);
  const { roundsRepo, roundsService, notificationsRepository, recalculationOrchestrator } = buildServices();

  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const systemSettingsService = createSystemSettingsService(settingsRepo);
  const authService = createAuthService({
    pool, logger, authProvider, users, players, activationTokens, passwordResetTokens,
    mfa: mfaRepo, mfaVerifier: mfaService, notifications: notificationsRepository,
  });
  const clubsService = createClubsService(clubsRepo, logger);
  const coursesService = createCoursesService(coursesRepo, logger);
  const adminUsersService = createAdminUsersService(pool, logger, users, players, activationTokens, notificationsRepository);
  const pccService = createPccService(createPccRepository(pool));
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, players, logger);
  const dashboardService = createDashboardService(handicapHistoryService, roundsService, users, coursesRepo, createPresenceSnapshotsRepository(pool), systemSettingsService, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, recalculationOrchestrator, handicapHistoryService, dashboardService, playersRepository: players, authProvider,
  });

  return { app, roundsRepo, roundsService, players, adminUsersService, authService };
}

async function startServer(app: ReturnType<typeof buildWorkflowApp>["app"]) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test("GET /admin/rounds (ghs#100): returns rounds across every status, filterable by status/playerId, paginated, and 403 for a player", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const { app, roundsRepo, players, adminUsersService, authService } = buildWorkflowApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const playerA = await players.create({ firstName: "Admin", lastName: "BrowseA" });
    const playerB = await players.create({ firstName: "Admin", lastName: "BrowseB" });

    // A spread of rounds across different statuses and both players.
    const draft = await roundsRepo.create({ playerId: playerA.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" });
    const pending = await roundsRepo.create({ playerId: playerA.id, teeConfigurationId, playedAt: "2026-05-02T09:00:00.000Z" });
    await roundsRepo.setStatus(pending.id, "pending");
    const approved = await roundsRepo.create({ playerId: playerB.id, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
    await roundsRepo.setStatus(approved.id, "approved");
    // ghs#168: a real score, so the list can be asserted to surface it --
    // the whole point of the Daily PCC screen's data source.
    await roundsRepo.updateScores(pending.id, { grossScore: 90, adjustedGrossScore: 88, scoreDifferential: 12.3, pcc: 0 });

    // ghs#168: a second tee-configuration, same day as `draft`, to prove
    // teeConfigurationId/playedOn actually scope the query rather than
    // just being accepted and ignored.
    const otherTeeConfigurationId = await createTeeConfiguration(72.0, 113, "Round Workflow Test Course (Other Tee)");
    const otherTeeSameDay = await roundsRepo.create({ playerId: playerA.id, teeConfigurationId: otherTeeConfigurationId, playedAt: "2026-05-01T15:00:00.000Z" });

    const admin = await adminUsersService.adminCreateUser({
      email: "browse-admin@example.com", password: "admin-pw-1", role: "admin",
      firstName: "Browse", lastName: "Admin", autoActivate: true,
    });
    const playerUser = await adminUsersService.adminCreateUser({
      email: "browse-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Browse", lastName: "Player", autoActivate: true,
    });
    const adminLogin = await authService.login("browse-admin@example.com", "admin-pw-1");
    const playerLogin = await authService.login("browse-player@example.com", "player-pw-1");
    if (adminLogin.status !== "authenticated" || playerLogin.status !== "authenticated") throw new Error("unreachable");
    const asAdmin = { Authorization: `Bearer ${adminLogin.tokens.accessToken}` };
    const asPlayer = { Authorization: `Bearer ${playerLogin.tokens.accessToken}` };

    // A player is rejected outright -- this is an admin-only browser.
    const playerAttempt = await fetch(`${baseUrl}/api/v1/admin/rounds`, { headers: asPlayer });
    assert.equal(playerAttempt.status, 403);

    // No filter -- all four rounds, regardless of status or tee configuration.
    const allResponse = await fetch(`${baseUrl}/api/v1/admin/rounds`, { headers: asAdmin });
    assert.equal(allResponse.status, 200);
    type AdminRoundListItemBody = {
      id: string;
      status: string;
      grossScore: number | null;
      adjustedGrossScore: number | null;
      scoreDifferential: number | null;
      pcc: number | null;
    };
    const all = await allResponse.json() as { items: AdminRoundListItemBody[]; total: number };
    assert.equal(all.total, 4);
    assert.deepEqual(new Set(all.items.map((i) => i.id)), new Set([draft.id, pending.id, approved.id, otherTeeSameDay.id]));

    // ghs#168: a round scored (submission-time, or here a directly-
    // written fixture standing in for it) before approval must surface
    // its real score fields here -- the Daily PCC screen's whole reason
    // for extending this endpoint rather than inventing a parallel one.
    const scoredItem = all.items.find((i) => i.id === pending.id)!;
    assert.equal(scoredItem.grossScore, 90);
    assert.equal(scoredItem.adjustedGrossScore, 88);
    assert.equal(scoredItem.scoreDifferential, 12.3);
    assert.equal(scoredItem.pcc, 0);
    const unscoredItem = all.items.find((i) => i.id === draft.id)!;
    assert.equal(unscoredItem.grossScore, null);
    assert.equal(unscoredItem.scoreDifferential, null);

    // ghs#168: teeConfigurationId + playedOn together scope to exactly
    // one tee/day -- otherTeeSameDay shares draft's date but not its tee
    // configuration, and must be excluded.
    const dailyResponse = await fetch(
      `${baseUrl}/api/v1/admin/rounds?teeConfigurationId=${teeConfigurationId}&playedOn=2026-05-01`,
      { headers: asAdmin },
    );
    const daily = await dailyResponse.json() as { items: AdminRoundListItemBody[]; total: number };
    assert.equal(daily.total, 1);
    assert.equal(daily.items[0]!.id, draft.id);

    // The other tee configuration's own round, same day, filtered on its
    // own id -- confirms the filter narrows by tee configuration, not just
    // date.
    const otherTeeDailyResponse = await fetch(
      `${baseUrl}/api/v1/admin/rounds?teeConfigurationId=${otherTeeConfigurationId}&playedOn=2026-05-01`,
      { headers: asAdmin },
    );
    const otherTeeDaily = await otherTeeDailyResponse.json() as { items: AdminRoundListItemBody[]; total: number };
    assert.equal(otherTeeDaily.total, 1);
    assert.equal(otherTeeDaily.items[0]!.id, otherTeeSameDay.id);

    // status filter.
    const pendingOnlyResponse = await fetch(`${baseUrl}/api/v1/admin/rounds?status=pending`, { headers: asAdmin });
    const pendingOnly = await pendingOnlyResponse.json() as { items: Array<{ id: string }>; total: number };
    assert.equal(pendingOnly.total, 1);
    assert.equal(pendingOnly.items[0]!.id, pending.id);

    // playerId filter.
    const playerBOnlyResponse = await fetch(`${baseUrl}/api/v1/admin/rounds?playerId=${playerB.id}`, { headers: asAdmin });
    const playerBOnly = await playerBOnlyResponse.json() as { items: Array<{ id: string }>; total: number };
    assert.equal(playerBOnly.total, 1);
    assert.equal(playerBOnly.items[0]!.id, approved.id);

    // Pagination: limit=1 still reports the real total across all rounds.
    const pagedResponse = await fetch(`${baseUrl}/api/v1/admin/rounds?limit=1&offset=0`, { headers: asAdmin });
    const paged = await pagedResponse.json() as { items: Array<{ id: string }>; total: number };
    assert.equal(paged.items.length, 1);
    assert.equal(paged.total, 4, "total reflects the full filtered set, not just this page's length");

    // An invalid status value is a 400, not a silently-ignored filter.
    const invalidStatus = await fetch(`${baseUrl}/api/v1/admin/rounds?status=bogus`, { headers: asAdmin });
    assert.equal(invalidStatus.status, 400);

    void playerUser;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin-created round auto-approval (ghs#100): submitting a round created by an admin/super_admin lands directly in 'approved' with a real recalculation, bypassing the pending queue", async () => {
  // Real metadata for exactly one hole -- same pattern as
  // rounds.integration.test.ts's "Completeness Test Course": the
  // completeness check (and the HTTP route's hole-metadata lookup) is
  // driven by teeConfiguration.holes.length, not the nominal holeCount,
  // so a single recorded hole is enough to make the round submittable.
  const coursesRepo = createCoursesRepository(pool);
  const course = await coursesRepo.create({
    name: "Auto-Approval Test Course", country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 68.0, slopeRating: 113, holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 1 }] }],
  });
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const { app, roundsRepo, players, adminUsersService, authService, roundsService } = buildWorkflowApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const player = await players.create({ firstName: "AutoApprove", lastName: "Target" });

    await adminUsersService.adminCreateUser({
      email: "auto-approve-admin@example.com", password: "admin-pw-1", role: "admin",
      firstName: "AutoApprove", lastName: "Admin", autoActivate: true,
    });
    const adminLogin = await authService.login("auto-approve-admin@example.com", "admin-pw-1");
    if (adminLogin.status !== "authenticated") throw new Error("unreachable");
    const asAdmin = { "Content-Type": "application/json", Authorization: `Bearer ${adminLogin.tokens.accessToken}` };

    // Admin creates the round on the player's behalf via the real HTTP
    // route -- createdByRole is captured from the caller's own JWT
    // identity, not a client-supplied field.
    const createResponse = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST", headers: asAdmin,
      body: JSON.stringify({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    assert.equal(createResponse.status, 201);
    const round = await createResponse.json() as { id: string };

    const holeResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/holes`, {
      method: "POST", headers: asAdmin, body: JSON.stringify({ holeNumber: 1, strokes: 6, putts: 2, gir: true }),
    });
    assert.equal(holeResponse.status, 200);

    const submitResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/submit`, { method: "POST", headers: asAdmin });
    assert.equal(submitResponse.status, 200);

    // Lands directly in 'approved' -- never visible in the pending queue.
    const reloaded = await roundsRepo.get(round.id);
    assert.equal(reloaded!.status, "approved", "an admin-created round is auto-approved on submit, not routed to pending");
    assert.ok(reloaded!.scoreDifferential !== null, "a real recalculation ran, not just a status flip");

    const queue = await roundsService.listPendingQueue();
    assert.equal(queue.find((item) => item.id === round.id), undefined, "the auto-approved round never appears in the pending queue");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a player-created round is unaffected by the auto-approval fast path -- still lands in 'pending' on submit (ghs#100 regression)", async () => {
  const course = await (async () => {
    const coursesRepo = createCoursesRepository(pool);
    return coursesRepo.create({
      name: "Player Regression Course", country: "ES",
      teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 68.0, slopeRating: 113, holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 1 }] }],
    });
  })();
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const { app, roundsRepo, players, adminUsersService, authService, roundsService } = buildWorkflowApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const playerUser = await adminUsersService.adminCreateUser({
      email: "regression-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Regression", lastName: "Player", autoActivate: true,
    });
    const playerRecord = await players.findByUserId(playerUser.userId);
    const login = await authService.login("regression-player@example.com", "player-pw-1");
    if (login.status !== "authenticated") throw new Error("unreachable");
    const asPlayer = { "Content-Type": "application/json", Authorization: `Bearer ${login.tokens.accessToken}` };

    const createResponse = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST", headers: asPlayer,
      body: JSON.stringify({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    const round = await createResponse.json() as { id: string };

    const holeResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/holes`, {
      method: "POST", headers: asPlayer, body: JSON.stringify({ holeNumber: 1, strokes: 5 }),
    });
    assert.equal(holeResponse.status, 200);

    const submitResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/submit`, { method: "POST", headers: asPlayer });
    assert.equal(submitResponse.status, 200);

    const reloaded = await roundsRepo.get(round.id);
    assert.equal(reloaded!.status, "pending", "a player-created round still requires admin review -- the fast path must not apply here");

    const queue = await roundsService.listPendingQueue();
    assert.ok(queue.some((item) => item.id === round.id), "still visible in the pending queue, unaffected by ghs#100's fast path");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a player taking over an admin-drafted round cannot bypass review by submitting it themselves (ghs#100 review fix, PR #141)", async () => {
  // Real hole metadata for exactly one hole -- same pattern as the
  // auto-approval test above.
  const coursesRepo = createCoursesRepository(pool);
  const course = await coursesRepo.create({
    name: "Escalation Test Course", country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 68.0, slopeRating: 113, holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 1 }] }],
  });
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const { app, roundsRepo, players, adminUsersService, authService, roundsService } = buildWorkflowApp();
  const { server, baseUrl } = await startServer(app);

  try {
    await adminUsersService.adminCreateUser({
      email: "escalation-admin@example.com", password: "admin-pw-1", role: "admin",
      firstName: "Escalation", lastName: "Admin", autoActivate: true,
    });
    // A real login-linked player record (same pattern as
    // rounds.integration.test.ts's own player HTTP tests) -- so the
    // player's own submission below is a genuine authorized action on
    // their own round, not merely testing an authorization-boundary
    // rejection.
    const playerUser = await adminUsersService.adminCreateUser({
      email: "escalation-player@example.com", password: "player-pw-1", role: "player",
      firstName: "Escalation", lastName: "PlayerAccount", autoActivate: true,
    });
    const player = await players.findByUserId(playerUser.userId);

    const adminLogin = await authService.login("escalation-admin@example.com", "admin-pw-1");
    const playerLogin = await authService.login("escalation-player@example.com", "player-pw-1");
    if (adminLogin.status !== "authenticated" || playerLogin.status !== "authenticated") throw new Error("unreachable");
    const asAdmin = { "Content-Type": "application/json", Authorization: `Bearer ${adminLogin.tokens.accessToken}` };
    const asPlayer = { "Content-Type": "application/json", Authorization: `Bearer ${playerLogin.tokens.accessToken}` };

    // Admin drafts the round on the player's behalf -- createdByRole is
    // 'admin' -- but never submits it themselves.
    const createResponse = await fetch(`${baseUrl}/api/v1/rounds`, {
      method: "POST", headers: asAdmin,
      body: JSON.stringify({ playerId: player!.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z" }),
    });
    assert.equal(createResponse.status, 201);
    const round = await createResponse.json() as { id: string };

    // The player themselves takes over -- records the hole score and
    // submits it as their own action. Before the review fix, this would
    // have auto-approved purely because createdByRole was 'admin',
    // silently bypassing review for what is now genuinely the player's
    // own submission.
    const holeResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/holes`, {
      method: "POST", headers: asPlayer, body: JSON.stringify({ holeNumber: 1, strokes: 6 }),
    });
    assert.equal(holeResponse.status, 200);

    const submitResponse = await fetch(`${baseUrl}/api/v1/rounds/${round.id}/submit`, { method: "POST", headers: asPlayer });
    assert.equal(submitResponse.status, 200);

    const reloaded = await roundsRepo.get(round.id);
    assert.equal(reloaded!.status, "pending", "a player's own submission must still require review, regardless of who originally drafted the round");

    const queue = await roundsService.listPendingQueue();
    assert.ok(queue.some((item) => item.id === round.id), "visible in the pending queue -- the fast path never applied to this submission");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the admin-created-round auto-approval fast path genuinely locks the round row before its completeness check -- a concurrent holder blocks it until released (ghs#100 review fix, PR #141)", async () => {
  // Real hole metadata for exactly one hole, same pattern as the other
  // ghs#100 tests above -- one recorded score is enough to satisfy
  // completeness.
  const coursesRepo = createCoursesRepository(pool);
  const course = await coursesRepo.create({
    name: "Lock Race Test Course", country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating: 68.0, slopeRating: 113, holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 1 }] }],
  });
  const teeConfigurationId = course.teeConfigurations[0]!.id;
  const { roundsRepo, players, roundsService } = buildServices();

  const player = await players.create({ firstName: "Lock", lastName: "Race" });
  const round = await roundsRepo.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-01T09:00:00.000Z", createdByRole: "admin" });
  await roundsRepo.addHoleScore(round.id, { holeNumber: 1, strokes: 5 });

  // Manually hold exactly the row lock submitAdminCreatedRound's own
  // quiet pending-transition needs -- the same real SQL
  // runWorkflowTransition's getForUpdate runs internally.
  const holdingClient = await pool.connect();
  await holdingClient.query("BEGIN");
  await holdingClient.query("SELECT id FROM rounds WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [round.id]);

  let completed = false;
  const submitPromise = roundsService
    .submitForReview(round.id, "admin")
    .then((result) => {
      completed = true;
      return result;
    });

  // Give it every real chance to run if the completeness check/rescore
  // were (wrongly) still happening outside any lock -- the pre-fix
  // implementation would have raced straight through this window.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(completed, false, "still blocked -- the quiet pending transition genuinely takes the row lock immediately, not after an unlocked completeness check");

  await holdingClient.query("COMMIT");
  holdingClient.release();

  const result = await submitPromise;
  assert.equal(result.round!.status, "approved", "proceeds correctly, using a fresh locked read, once the held lock is released");
});
