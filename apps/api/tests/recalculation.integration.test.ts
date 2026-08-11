import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createPccRepository } from "../src/data/pcc.repository.ts";
import { createPccService } from "../src/application/pcc.service.ts";
import { createHandicapHistoryRepository } from "../src/data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "../src/application/handicap-history.service.ts";
import { createRecalculationOrchestrator } from "../src/application/recalculation.service.ts";

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

async function createAdminUserId(): Promise<string> {
  const users = createUsersRepository(pool);
  const admin = await users.create({
    email: `recalc-admin-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });
  return admin.id;
}

async function createTeeConfiguration(courseRating = 72.0, slopeRating = 113): Promise<string> {
  const courses = createCoursesRepository(pool);
  const course = await courses.create({
    name: "Recalculation Test Course",
    country: "ES",
    teeConfigurations: [{ name: "White", holeCount: 18, courseRating, slopeRating, holes: [] }],
  });
  return course.teeConfigurations[0]!.id;
}

// Bypasses the (not-yet-built, ghs#23) approval workflow entirely --
// inserts a round already 'approved' with a known score_differential,
// directly via the repository layer, since this issue's own scope is
// "given some approved rounds with real differentials, recalculate
// correctly", not the workflow that gets a round into that state.
async function createApprovedRound(playerId: string, teeConfigurationId: string, playedAt: string, scoreDifferential: number): Promise<string> {
  const rounds = createRoundsRepository(pool);
  const round = await rounds.create({ playerId, teeConfigurationId, playedAt });
  await rounds.updateScores(round.id, { scoreDifferential });
  await rounds.setStatus(round.id, "approved");
  return round.id;
}

function buildOrchestrator() {
  const roundsRepo = createRoundsRepository(pool);
  const handicapHistoryRepo = createHandicapHistoryRepository(pool);
  const handicapHistoryService = createHandicapHistoryService(handicapHistoryRepo);
  const pccService = createPccService(createPccRepository(pool));
  const orchestrator = createRecalculationOrchestrator(roundsRepo, handicapHistoryService, pccService, logger);
  return { roundsRepo, handicapHistoryRepo, handicapHistoryService, pccService, orchestrator };
}

test("recalculatePlayerHandicap computes and persists a real handicap index from a player's real approved rounds, round-tripping through a fresh read", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Recalc", lastName: "Tester" });

  await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-03T09:00:00.000Z", 14.0);

  const { orchestrator, handicapHistoryService } = buildOrchestrator();
  const result = await orchestrator.recalculatePlayerHandicap(player.id, "round_approved");

  assert.equal(result.status, "eligible");
  // 3 scores -> lowest 1 (10.0), adjustment -2.0 -> (10-2)*0.96 = 7.68 -> truncated 7.6
  assert.equal(result.handicapIndex, 7.6);
  assert.ok(result.historyRecordId);

  // Round-trips through a fresh read, not just the write path's own return value.
  const current = await handicapHistoryService.getCurrentIndex(player.id);
  assert.equal(current!.handicapIndex, 7.6);
  const history = await handicapHistoryService.listHistoryForPlayer(player.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.method, "calculated");
});

test("recalculatePlayerHandicap only considers approved rounds -- pending and rejected rounds are ignored", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Status", lastName: "Aware" });
  const rounds = createRoundsRepository(pool);

  await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);

  // A third round exists with a real differential but is still pending --
  // must not count toward eligibility.
  const pendingRound = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt: "2026-05-03T09:00:00.000Z" });
  await rounds.updateScores(pendingRound.id, { scoreDifferential: 14.0 });

  const { orchestrator } = buildOrchestrator();
  const result = await orchestrator.recalculatePlayerHandicap(player.id, "round_approved");

  assert.equal(result.status, "insufficient_holes", "only 2 approved rounds -- the pending third one doesn't count");
});

test("recalculatePccForTeeConfigDay triggers exactly one recalculation per distinctly affected player, using real rounds", async () => {
  const teeConfigurationId = await createTeeConfiguration(72.0, 113);
  const players = createPlayersRepository(pool);
  const rounds = createRoundsRepository(pool);
  const playedAt = "2026-05-01T09:00:00.000Z";

  const playerIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const player = await players.create({ firstName: `Player${i}`, lastName: "PccAware" });
    playerIds.push(player.id);
    const round = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt });
    await rounds.updateScores(round.id, { adjustedGrossScore: 80 + i });
    await rounds.setStatus(round.id, "approved");
  }

  const { orchestrator } = buildOrchestrator();
  const adminUserId = await createAdminUserId();
  const result = await orchestrator.recalculatePccForTeeConfigDay(teeConfigurationId, playedAt, 1, adminUserId);

  assert.equal(result.updatedRounds, 3);
  assert.equal(result.playerRecalculations.length, 3, "exactly one recalculation attempt per distinct affected player");
  const recalculatedPlayerIds = result.playerRecalculations.map((r) => r.playerId).sort();
  assert.deepEqual(recalculatedPlayerIds, [...playerIds].sort());
  // Each player only has 1 approved round -- correctly still insufficient,
  // but each was genuinely attempted (not skipped).
  for (const r of result.playerRecalculations) {
    assert.equal(r.status, "insufficient_holes");
  }
});

test("recalculatePccForTeeConfigDay: one affected player being unrecoverable (soft-deleted) does not prevent the other affected players' recalculations from completing and committing", async () => {
  const teeConfigurationId = await createTeeConfiguration(72.0, 113);
  const players = createPlayersRepository(pool);
  const rounds = createRoundsRepository(pool);
  const playedAt = "2026-05-01T09:00:00.000Z";

  const survivingPlayerIds: string[] = [];
  let deletedPlayerId = "";
  for (let i = 0; i < 3; i += 1) {
    const player = await players.create({ firstName: `Player${i}`, lastName: "Independence" });
    const round = await rounds.create({ playerId: player.id, teeConfigurationId, playedAt });
    await rounds.updateScores(round.id, { adjustedGrossScore: 80 + i });
    await rounds.setStatus(round.id, "approved");
    // Give two of the three players enough additional approved rounds
    // elsewhere to actually be eligible, so a real handicap_history row
    // gets written for them -- proving a genuine commit, not just a
    // reached-but-ineligible attempt.
    if (i !== 1) {
      await createApprovedRound(player.id, teeConfigurationId, "2026-04-01T09:00:00.000Z", 9.0);
      await createApprovedRound(player.id, teeConfigurationId, "2026-04-02T09:00:00.000Z", 11.0);
      survivingPlayerIds.push(player.id);
    } else {
      deletedPlayerId = player.id;
    }
  }

  // Soft-delete the middle player -- their recalculation must report
  // player_not_found rather than crash the batch.
  await pool.query("UPDATE players SET deleted_at = now() WHERE id = $1", [deletedPlayerId]);

  const { orchestrator, handicapHistoryService } = buildOrchestrator();
  const adminUserId = await createAdminUserId();
  const result = await orchestrator.recalculatePccForTeeConfigDay(teeConfigurationId, playedAt, 2, adminUserId);

  assert.equal(result.playerRecalculations.length, 3, "all three affected players were attempted");
  const byPlayer = Object.fromEntries(result.playerRecalculations.map((r) => [r.playerId, r]));
  assert.equal(byPlayer[deletedPlayerId]!.status, "player_not_found");
  for (const survivingId of survivingPlayerIds) {
    assert.equal(byPlayer[survivingId]!.status, "eligible");
  }

  // The surviving players' results genuinely committed to the database,
  // not just returned in-memory -- proving the deleted player's failure
  // didn't roll anything else back.
  for (const survivingId of survivingPlayerIds) {
    const current = await handicapHistoryService.getCurrentIndex(survivingId);
    assert.ok(current!.handicapIndex !== null, "a real handicap index was persisted for this surviving player");
  }
});

// PR #31 review fix: recalculatePlayerHandicap previously had no way to
// participate in a caller-owned transaction at all -- it always opened
// its own connection internally. These two tests prove the fix for
// real, against a real database, not just by inspecting the code.

test("recalculatePlayerHandicap, given an external client, genuinely participates in the caller's transaction -- rolling back the caller's transaction rolls back the recalculation too", async () => {
  const teeConfigurationId = await createTeeConfiguration();
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Atomic", lastName: "Rollback" });

  await createApprovedRound(player.id, teeConfigurationId, "2026-05-01T09:00:00.000Z", 10.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-02T09:00:00.000Z", 12.0);
  await createApprovedRound(player.id, teeConfigurationId, "2026-05-03T09:00:00.000Z", 14.0);

  const { orchestrator, handicapHistoryService } = buildOrchestrator();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await orchestrator.recalculatePlayerHandicap(player.id, "round_approved", client);
    assert.equal(result.status, "eligible", "the recalculation itself succeeded, within the transaction");
    // The caller decides to abort -- simulating, e.g., a subsequent step
    // in ghs#23's approval handler failing after the recalculation ran.
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  // Nothing committed -- the player's cached index and history must be
  // exactly as if recalculatePlayerHandicap were never called.
  const current = await handicapHistoryService.getCurrentIndex(player.id);
  assert.equal(current!.handicapIndex, null, "rolled back -- no cached index was persisted");
  const history = await handicapHistoryService.listHistoryForPlayer(player.id);
  assert.equal(history.length, 0, "rolled back -- no handicap_history row was persisted");
});

test("recalculatePlayerHandicap, given an external client, lets a real database error propagate instead of swallowing it into a 'failed' outcome", async () => {
  const { orchestrator } = buildOrchestrator();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Deliberately invalid UUID -- a real Postgres error, not a
    // constructed/mocked one, so this proves the real repository layer's
    // error genuinely reaches the caller.
    await assert.rejects(
      () => orchestrator.recalculatePlayerHandicap("not-a-real-uuid", "round_approved", client),
      /invalid input syntax for type uuid/,
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("recalculatePlayerHandicap without a client still self-manages its own transaction and catches its own errors, exactly as before -- existing (no-client) callers are unaffected", async () => {
  const { orchestrator } = buildOrchestrator();

  const result = await orchestrator.recalculatePlayerHandicap("not-a-real-uuid", "round_approved");
  assert.equal(result.status, "failed", "no client provided -- the error is caught and reported, not thrown");
  assert.match(result.error!, /invalid input syntax for type uuid/);
});
