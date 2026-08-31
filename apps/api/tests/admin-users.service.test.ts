import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { createAdminUsersService, EmailAlreadyInUseError } from "../src/application/admin-users.service.ts";
import { createLogger } from "../src/logger.ts";
import type { User, UserRole, UsersRepository } from "../src/data/users.repository.ts";
import type { Player, PlayersRepository } from "../src/data/players.repository.ts";
import type { ActivationTokenRepository } from "../src/data/activation-tokens.repository.ts";
import type { NotificationsRepository } from "../src/data/notifications.repository.ts";

// ghs#191 review finding, PR #192: a real concurrency race (two
// requests both passing the findByEmail check before either writes)
// can't be forced deterministically over a real HTTP+Postgres round
// trip -- fast enough that the two requests just serialize instead of
// actually overlapping at the SQL statement level. Tested at this
// level instead: the service's own handling of a raw 23505 from the
// repository, which is exactly what a genuine race produces at the
// database layer regardless of timing.

// A fake pg.Pool -- BEGIN/COMMIT/ROLLBACK calls are recorded so tests
// can assert on transaction integrity (same pattern as
// handicap-overrides.service.test.ts's own fakePool).
function fakePool(): { pool: Pool; queries: string[] } {
  const queries: string[] = [];
  const fakeClient = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: () => { /* no-op */ },
  } as unknown as PoolClient;
  return { pool: { connect: async () => fakeClient } as unknown as Pool, queries };
}

const silentLogger = createLogger("test");

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "original@example.com",
    passwordHash: "irrelevant",
    status: "active",
    role: "player",
    emailVerifiedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "player-1",
    userId: "user-1",
    clubId: null,
    firstName: "Original",
    lastName: "Name",
    country: "GB",
    createdAt: new Date().toISOString(),
    handicapIndex: null,
    lowHandicapIndex: null,
    ...overrides,
  };
}

function notUsed(): never {
  throw new Error("not used by these tests");
}

function fakeUsersRepository(overrides: Partial<UsersRepository> = {}): UsersRepository {
  return {
    create: notUsed,
    findByEmail: notUsed,
    findById: notUsed,
    markEmailVerified: notUsed,
    setStatus: notUsed,
    setPasswordHash: notUsed,
    updateEmail: notUsed,
    updateRole: notUsed,
    list: notUsed,
    updateLastActiveAt: notUsed,
    countActiveNow: notUsed,
    getRoleBreakdown: notUsed,
    getRegistrationTrend: notUsed,
    ...overrides,
  } as UsersRepository;
}

function fakePlayersRepository(overrides: Partial<PlayersRepository> = {}): PlayersRepository {
  return {
    create: notUsed,
    findByUserId: notUsed,
    findByUserIds: notUsed,
    get: notUsed,
    updateName: notUsed,
    ...overrides,
  } as PlayersRepository;
}

function unusedActivationTokens(): ActivationTokenRepository {
  return {
    create: notUsed,
    findByHash: notUsed,
    markUsed: notUsed,
  } as unknown as ActivationTokenRepository;
}

function unusedNotifications(): NotificationsRepository {
  return { record: notUsed, listForUser: notUsed } as unknown as NotificationsRepository;
}

test("updateUser translates a raw 23505 from updateEmail into EmailAlreadyInUseError, not an unhandled raw error -- the real TOCTOU race's actual failure mode", async () => {
  const { pool } = fakePool();
  const users = fakeUsersRepository({
    findById: async () => fakeUser({ email: "original@example.com" }),
    findByEmail: async () => null, // The upfront check itself sees no conflict -- exactly the race window.
    updateEmail: async () => {
      const err = new Error("duplicate key value violates unique constraint") as Error & { code: string };
      err.code = "23505";
      throw err;
    },
  });
  const players = fakePlayersRepository({ findByUserId: async () => null });
  const service = createAdminUsersService(pool, silentLogger, users, players, unusedActivationTokens(), unusedNotifications());

  await assert.rejects(
    () => service.updateUser("user-1", { email: "raced-away@example.com" }),
    EmailAlreadyInUseError,
  );
});

test("updateUser lets a non-23505 error from updateEmail propagate as-is, not miscategorized as a duplicate email", async () => {
  const { pool } = fakePool();
  const users = fakeUsersRepository({
    findById: async () => fakeUser({ email: "original@example.com" }),
    findByEmail: async () => null,
    updateEmail: async () => {
      throw new Error("connection terminated unexpectedly");
    },
  });
  const players = fakePlayersRepository({ findByUserId: async () => null });
  const service = createAdminUsersService(pool, silentLogger, users, players, unusedActivationTokens(), unusedNotifications());

  await assert.rejects(
    () => service.updateUser("user-1", { email: "new@example.com" }),
    (err: unknown) => err instanceof Error && !(err instanceof EmailAlreadyInUseError) && err.message === "connection terminated unexpectedly",
  );
});

test("updateUser rolls back the transaction when a write fails partway through -- role change is never silently applied alongside a failed email change", async () => {
  const { pool, queries } = fakePool();
  let roleUpdateCalled = false;
  const users = fakeUsersRepository({
    findById: async () => fakeUser({ email: "original@example.com", role: "admin" }),
    findByEmail: async () => null,
    updateEmail: async () => {
      const err = new Error("duplicate key value violates unique constraint") as Error & { code: string };
      err.code = "23505";
      throw err;
    },
    updateRole: async () => {
      roleUpdateCalled = true;
    },
  });
  const players = fakePlayersRepository({ findByUserId: async () => null });
  const service = createAdminUsersService(pool, silentLogger, users, players, unusedActivationTokens(), unusedNotifications());

  await assert.rejects(() => service.updateUser("user-1", { email: "taken@example.com", role: "super_admin" as UserRole }));

  assert.equal(roleUpdateCalled, false, "the role write never ran -- email failed first, inside the same transaction");
  assert.ok(queries.includes("ROLLBACK"), "the transaction was rolled back, not left half-applied");
  assert.ok(!queries.includes("COMMIT"), "COMMIT must never be reached on a failed write");
});

test("updateUser commits once and returns the refreshed row on a successful multi-field update", async () => {
  const { pool, queries } = fakePool();
  // A genuinely stateful fake (unlike the other tests above, which only
  // need to observe individual calls) -- findById reflects whatever
  // updateEmail/updateRole most recently wrote, so this test can prove
  // the returned row is a real post-write read, not a static stub.
  let current = fakeUser({ email: "original@example.com", role: "admin" });
  const users = fakeUsersRepository({
    findById: async () => current,
    findByEmail: async () => null,
    updateEmail: async (_id, email) => {
      current = { ...current, email };
    },
    updateRole: async (_id, role) => {
      current = { ...current, role };
    },
  });
  const players = fakePlayersRepository({ findByUserId: async () => null });
  const service = createAdminUsersService(pool, silentLogger, users, players, unusedActivationTokens(), unusedNotifications());

  const result = await service.updateUser("user-1", { email: "corrected@example.com", role: "super_admin" });

  assert.equal(result.email, "corrected@example.com");
  assert.equal(result.role, "super_admin");
  assert.ok(queries.includes("COMMIT"));
  assert.ok(!queries.includes("ROLLBACK"));
});
