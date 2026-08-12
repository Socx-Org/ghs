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
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createScoringService } from "../src/application/scoring.service.ts";
import { createHandicapHistoryRepository } from "../src/data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "../src/application/handicap-history.service.ts";
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

async function createTeeConfiguration(courseRating = 72.0, slopeRating = 113): Promise<string> {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Round Workflow Test Course",
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
  const recalculationOrchestrator = createRecalculationOrchestrator(pool, roundsRepo, handicapHistoryService, pccService, notificationsRepository, logger);
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, recalculationOrchestrator, notificationsRepository, logger);
  return { roundsRepo, coursesRepo, handicapHistoryService, notificationsRepository, recalculationOrchestrator, roundsService };
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
  const result = await roundsService.rejectRound(round.id, "Never submitted a scorecard");

  assert.equal(result.round!.status, "rejected");
  assert.equal(result.recalculation, null);
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

  const result = await roundsService.deleteRound(toDeleteId);

  assert.equal(result.round, null, "a soft-deleted round is invisible to the same filtered read every other round uses");
  assert.ok(result.recalculation);
  assert.equal(result.recalculation!.handicapIndex, 9.6); // remaining {12,14,20} -> 9.6, same as the reject case above
  const current = await handicapHistoryService.getCurrentIndex(player.id);
  assert.equal(current!.handicapIndex, 9.6);

  // Genuinely gone, not just excluded from the calculation.
  assert.equal(await roundsRepo.get(toDeleteId), null);
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
  const { roundsRepo, coursesRepo, notificationsRepository } = buildServices();
  const scoringService = createScoringService(roundsRepo, coursesRepo, createPccService(createPccRepository(pool)));

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
  const roundsService = createRoundsService(pool, roundsRepo, coursesRepo, scoringService, failingRecalculation, notificationsRepository, logger);

  await assert.rejects(() => roundsService.approveRound(round.id), /simulated recalculation failure/);

  // setStatus ran before the failed recalculation call, inside the same
  // transaction -- it must not have committed on its own.
  const afterFailure = await roundsRepo.get(round.id);
  assert.equal(afterFailure!.status, "pending", "the status change rolled back together with the failed recalculation, not left half-applied");
});

test("HTTP: reject/reopen/delete are admin-only; invalid transitions are 409; a missing round is 404", async () => {
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
  const { roundsRepo, roundsService, notificationsRepository } = buildServices();

  const authProvider = createLocalAuthProvider(authConfig, refreshTokens);
  const mfaService = createMfaService(mfaRepo, authConfig.mfaEncryptionKey);
  const systemSettingsService = createSystemSettingsService(settingsRepo);
  const authService = createAuthService({
    pool, logger, authProvider, users, players, activationTokens, passwordResetTokens,
    mfa: mfaRepo, mfaVerifier: mfaService,
  });
  const clubsService = createClubsService(clubsRepo, logger);
  const coursesService = createCoursesService(coursesRepo, logger);
  const adminUsersService = createAdminUsersService(pool, logger, users, players, activationTokens);
  const pccService = createPccService(createPccRepository(pool));
  const handicapHistoryService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const handicapOverridesService = createHandicapOverridesService(pool, createHandicapOverridesRepository(pool), handicapHistoryService, notificationsRepository, logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, handicapOverridesService, pccService, playersRepository: players, authProvider,
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

    const asPlayer = { "Content-Type": "application/json", Authorization: `Bearer ${playerToken}` };
    const asAdmin = { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` };

    // A player cannot reject, reopen, or delete -- these are real
    // workflow actions, admin-only (matching legacy's own behaviour).
    const playerReject = await fetch(`${baseUrl}/rounds/${round.id}/status`, {
      method: "PATCH", headers: asPlayer, body: JSON.stringify({ status: "rejected", rejectionReason: "x" }),
    });
    assert.equal(playerReject.status, 403);

    const playerReopen = await fetch(`${baseUrl}/rounds/${round.id}/status`, {
      method: "PATCH", headers: asPlayer, body: JSON.stringify({ status: "amending", reason: "x" }),
    });
    assert.equal(playerReopen.status, 403);

    const playerDelete = await fetch(`${baseUrl}/rounds/${round.id}`, { method: "DELETE", headers: asPlayer });
    assert.equal(playerDelete.status, 403);

    // Admin reject without a reason is a validation error, not a silent no-op.
    const rejectNoReason = await fetch(`${baseUrl}/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "rejected" }),
    });
    assert.equal(rejectNoReason.status, 400);

    // Admin rejects for real.
    const rejectResponse = await fetch(`${baseUrl}/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "rejected", rejectionReason: "Incomplete scorecard" }),
    });
    assert.equal(rejectResponse.status, 200);
    const rejected = await rejectResponse.json() as RoundWorkflowResult;
    assert.equal(rejected.round!.status, "rejected");

    // A rejected round cannot be reopened for amendment -- only 'approved' may.
    const reopenRejected = await fetch(`${baseUrl}/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "amending", reason: "x" }),
    });
    assert.equal(reopenRejected.status, 409);

    // A rejected round cannot be rejected again.
    const rejectAgain = await fetch(`${baseUrl}/rounds/${round.id}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "rejected", rejectionReason: "again" }),
    });
    assert.equal(rejectAgain.status, 409);

    // A missing round is 404, not a 500, on both endpoints.
    const missingId = "00000000-0000-0000-0000-000000000000";
    const missingStatus = await fetch(`${baseUrl}/rounds/${missingId}/status`, {
      method: "PATCH", headers: asAdmin, body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(missingStatus.status, 404);
    const missingDelete = await fetch(`${baseUrl}/rounds/${missingId}`, { method: "DELETE", headers: asAdmin });
    assert.equal(missingDelete.status, 404);

    // A blank rejectionReason must not shadow a real value in reason, and
    // both are trimmed before persisting (caught in review, PR #32).
    const thirdRound = await roundsRepo.create({ playerId: playerRecord!.id, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
    const reasonFallbackResponse = await fetch(`${baseUrl}/rounds/${thirdRound.id}/status`, {
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
    const deleteResponse = await fetch(`${baseUrl}/rounds/${secondRound.id}`, { method: "DELETE", headers: asAdmin });
    assert.equal(deleteResponse.status, 200);
    const deleted = await deleteResponse.json() as RoundWorkflowResult;
    assert.equal(deleted.round, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
