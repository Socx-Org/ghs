import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applyMigrations } from "./helpers/apply-migrations.ts";
import { createLogger } from "../src/logger.ts";
import { createSystemSettingsRepository } from "../src/data/system-settings.repository.ts";
import { createSystemSettingsService } from "../src/application/system-settings.service.ts";
import { createUsersRepository } from "../src/data/users.repository.ts";
import { createPlayersRepository } from "../src/data/players.repository.ts";
import { createActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "../src/data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import { createMfaRepository } from "../src/data/mfa.repository.ts";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import { createAuthService } from "../src/application/auth.service.ts";
import { createMfaService } from "../src/application/mfa.service.ts";
import { createClubsRepository } from "../src/data/clubs.repository.ts";
import { createCoursesRepository } from "../src/data/courses.repository.ts";
import { createClubsService } from "../src/application/clubs.service.ts";
import { createCoursesService } from "../src/application/courses.service.ts";
import { createAdminUsersService } from "../src/application/admin-users.service.ts";
import { createRoundsRepository } from "../src/data/rounds.repository.ts";
import { createRoundsService } from "../src/application/rounds.service.ts";
import { createApp } from "../src/interface/http/app.ts";
import type { AuthConfig } from "../src/config.ts";

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

test("system_settings round-trips through a real database (APP-020's generic key/value shape)", async () => {
  const repo = createSystemSettingsRepository(pool);

  const created = await repo.upsert("pcc_override", "2", "Playing Conditions Calculation override", null);
  assert.equal(created.value, "2");

  const fetched = await repo.get("pcc_override");
  assert.equal(fetched!.value, "2");

  const updated = await repo.upsert("pcc_override", "-1", "Playing Conditions Calculation override", null);
  assert.equal(updated.value, "-1");

  await repo.delete("pcc_override");
  assert.equal(await repo.get("pcc_override"), null);
});

test("settings are read live, not cached -- two independent service instances see the same write immediately (APP-020's core requirement)", async () => {
  const repoA = createSystemSettingsRepository(pool);
  const repoB = createSystemSettingsRepository(pool);
  const serviceA = createSystemSettingsService(repoA);
  const serviceB = createSystemSettingsService(repoB);

  assert.equal(await serviceB.getMaintenanceMode(), false);
  await serviceA.setMaintenanceMode(true, null);
  // No shared in-memory cache between A and B -- B must see A's write on
  // its very next read, proving there's nothing to invalidate.
  assert.equal(await serviceB.getMaintenanceMode(), true);
});

test("pcc_override's out-of-range rejection holds against a real database too, not just the fake repository in unit tests", async () => {
  const service = createSystemSettingsService(createSystemSettingsRepository(pool));
  await assert.rejects(() => service.setPccOverride(4, "admin-1"));

  const row = await createSystemSettingsRepository(pool).get("pcc_override");
  assert.equal(row, null, "a rejected write must never reach the database");
});

test("self-registration gate: POST /auth/register is 403 when off, 201 when on -- real HTTP, real app.ts wiring", async () => {
  const users = createUsersRepository(pool);
  const players = createPlayersRepository(pool);
  const activationTokens = createActivationTokenRepository(pool);
  const passwordResetTokens = createPasswordResetTokenRepository(pool);
  const refreshTokens = createRefreshTokensRepository(pool);
  const mfaRepo = createMfaRepository(pool);
  const clubsRepo = createClubsRepository(pool);
  const coursesRepo = createCoursesRepository(pool);
  const settingsRepo = createSystemSettingsRepository(pool);

  const authConfig: AuthConfig = {
    jwtSecret: "system-settings-test-secret",
    jwtAccessExpiresInSeconds: 900,
    jwtRefreshExpiresInSeconds: 2_592_000,
    mfaPendingExpiresInSeconds: 300,
    mfaEncryptionKey: randomBytes(32),
  };

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
  const roundsService = createRoundsService(createRoundsRepository(pool), logger);

  const app = createApp({
    logger, clubsService, coursesService, authService, mfaService,
    adminUsersService, systemSettingsService, roundsService, playersRepository: players, authProvider,
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Off by default (matches legacy's conservative default).
    const blockedResponse = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "gated@example.com", password: "gated-test-pw", firstName: "Gated", lastName: "User" }),
    });
    assert.equal(blockedResponse.status, 403);

    await systemSettingsService.setSelfRegistrationEnabled(true, null);

    const allowedResponse = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "gated@example.com", password: "gated-test-pw", firstName: "Gated", lastName: "User" }),
    });
    assert.equal(allowedResponse.status, 201);

    const registeredUser = await users.findByEmail("gated@example.com");
    assert.ok(registeredUser);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
