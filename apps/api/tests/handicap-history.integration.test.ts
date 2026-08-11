import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createHandicapHistoryRepository } from "../src/data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "../src/application/handicap-history.service.ts";
import { createHandicapOverridesRepository } from "../src/data/handicap-overrides.repository.ts";
import { createHandicapOverridesService } from "../src/application/handicap-overrides.service.ts";
import { createLogger } from "../src/logger.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const logger = createLogger("test");

before(async () => {
  await applyMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE clubs, users RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool.end();
});

test("recordCalculatedResult writes a history row and updates the player's cached handicap_index/low_handicap_index", async () => {
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Handicap", lastName: "History" });
  const service = createHandicapHistoryService(createHandicapHistoryRepository(pool));

  const result = await service.recordCalculatedResult(player.id, 14.2, "2026-05-01T00:00:00.000Z", { differentialsUsed: [12.1, 13.4] });

  assert.equal(result.history!.method, "calculated");
  assert.equal(result.handicapIndex, 14.2);
  assert.equal(result.lowHandicapIndex, 14.2);
  assert.deepEqual(result.history!.calculationSnapshot, { differentialsUsed: [12.1, 13.4] });

  const current = await service.getCurrentIndex(player.id);
  assert.equal(current!.handicapIndex, 14.2);
  assert.equal(current!.lowHandicapIndex, 14.2);
});

test("an unchanged recalculation writes no new handicap_history row and leaves the player untouched", async () => {
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Unchanged", lastName: "Recalc" });
  const service = createHandicapHistoryService(createHandicapHistoryRepository(pool));

  await service.recordCalculatedResult(player.id, 14.2, "2026-05-01T00:00:00.000Z", {});
  const result = await service.recordCalculatedResult(player.id, 14.2, "2026-05-02T00:00:00.000Z", {});

  assert.equal(result.history, null, "no new row was written -- a genuine no-op");

  const history = await service.listHistoryForPlayer(player.id);
  assert.equal(history.length, 1, "still just the one original row");
});

test("Low Handicap Index is a rolling 365-day window, anchored to each change's own calculation_date -- not an all-time low", async () => {
  const players = createPlayersRepository(pool);
  const player = await players.create({ firstName: "Rolling", lastName: "Window" });
  const service = createHandicapHistoryService(createHandicapHistoryRepository(pool));

  // A very low index, but 366 days before the final calculation below --
  // must be excluded from the window. If the window were wrongly
  // computed as an all-time low (legacy's actual behaviour, not
  // preserved), this value would incorrectly win.
  await service.recordCalculatedResult(player.id, 5.0, "2024-12-31T00:00:00.000Z", {});
  // Exactly 365 days before the final calculation -- the boundary is
  // inclusive.
  await service.recordCalculatedResult(player.id, 15.0, "2025-01-01T00:00:00.000Z", {});
  // The change under test.
  const result = await service.recordCalculatedResult(player.id, 18.0, "2026-01-01T00:00:00.000Z", {});

  assert.equal(result.lowHandicapIndex, 15.0, "the 366-day-old 5.0 must be excluded; 15.0 (exactly 365 days) and 18.0 (the new value) are the real window");

  const current = await service.getCurrentIndex(player.id);
  assert.equal(current!.lowHandicapIndex, 15.0);
});

test("a manual override writes to both handicap_overrides (ghs#10's admin-action log) and handicap_history (this issue's index-value timeline), via the one shared write function -- real database proof", async () => {
  const players = createPlayersRepository(pool);
  const users = createUsersRepository(pool);
  const player = await players.create({ firstName: "Shared", lastName: "WritePath" });
  const admin = await users.create({
    email: `history-admin-${Date.now()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });

  const overridesRepo = createHandicapOverridesRepository(pool);
  const historyRepo = createHandicapHistoryRepository(pool);
  const historyService = createHandicapHistoryService(historyRepo);
  const overridesService = createHandicapOverridesService(overridesRepo, historyService, logger);

  await overridesService.createOverride({
    playerId: player.id,
    adminUserId: admin.id,
    previousIndex: 12.4,
    newIndex: 10.1,
    reason: "Verified against a paper handicap certificate",
  });

  const overrides = await overridesRepo.listForPlayer(player.id);
  assert.equal(overrides.length, 1, "handicap_overrides -- the admin-action log -- still gets its own row, unchanged");

  const history = await historyRepo.listForPlayer(player.id);
  assert.equal(history.length, 1, "handicap_history -- the index-value timeline -- also gets a row, through the shared write path");
  assert.equal(history[0]!.method, "manual_override");
  assert.equal(history[0]!.handicapIndex, 10.1);
  assert.equal(history[0]!.reason, "Verified against a paper handicap certificate");
  assert.equal(history[0]!.createdBy, admin.id);

  const current = await historyService.getCurrentIndex(player.id);
  assert.equal(current!.handicapIndex, 10.1, "players.handicap_index reflects the override too, not only calculated results");
});

test("a manual override without a reason is rejected before reaching either table", async () => {
  const players = createPlayersRepository(pool);
  const users = createUsersRepository(pool);
  const player = await players.create({ firstName: "No", lastName: "Reason" });
  const admin = await users.create({
    email: `history-admin-noreason-${Date.now()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    role: "admin",
    status: "active",
  });

  const overridesRepo = createHandicapOverridesRepository(pool);
  const historyService = createHandicapHistoryService(createHandicapHistoryRepository(pool));
  const overridesService = createHandicapOverridesService(overridesRepo, historyService, logger);

  await assert.rejects(() =>
    overridesService.createOverride({ playerId: player.id, adminUserId: admin.id, newIndex: 10.0, reason: "" }),
  );
});
