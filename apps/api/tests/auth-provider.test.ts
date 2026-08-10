import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createLocalAuthProvider } from "../src/application/auth-provider.ts";
import type { RefreshTokenRecord, RefreshTokensRepository } from "../src/data/refresh-tokens.repository.ts";
import type { User } from "../src/data/users.repository.ts";
import type { AuthConfig } from "../src/config.ts";

// Pure unit tests -- no HTTP, no real database (ENG-030.3). A fake
// RefreshTokensRepository stands in for pg entirely, same pattern as
// reference/application's widgets.service.test.ts.
function fakeRefreshTokens(): RefreshTokensRepository & { records: Map<string, RefreshTokenRecord> } {
  const records = new Map<string, RefreshTokenRecord>();
  let nextId = 1;
  return {
    records,
    async create(userId, tokenHash, expiresAt) {
      records.set(tokenHash, { id: String(nextId++), userId, expiresAt, rotatedAt: null, revokedAt: null });
    },
    async findByHash(tokenHash) {
      return records.get(tokenHash) ?? null;
    },
    async markRotated(id) {
      for (const record of records.values()) {
        if (record.id === id) record.rotatedAt = new Date();
      }
    },
    async revokeAllForUser(userId) {
      for (const record of records.values()) {
        if (record.userId === userId) record.revokedAt = new Date();
      }
    },
  };
}

const config: AuthConfig = {
  jwtSecret: "unit-test-secret",
  jwtAccessExpiresInSeconds: 900,
  jwtRefreshExpiresInSeconds: 2_592_000,
  mfaPendingExpiresInSeconds: 300,
  mfaEncryptionKey: randomBytes(32),
};

const fakeUser: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "unit@example.com",
  passwordHash: "irrelevant-for-this-test",
  status: "active",
  role: "player",
  emailVerifiedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("issueTokens produces a verifiable access token with OIDC-shaped claims", async () => {
  const refreshTokens = fakeRefreshTokens();
  const provider = createLocalAuthProvider(config, refreshTokens);

  const tokens = await provider.issueTokens(fakeUser, ["pwd"]);
  const identity = provider.verifyAccessToken(tokens.accessToken);

  assert.equal(identity.sub, fakeUser.id);
  assert.equal(identity.email, fakeUser.email);
  assert.equal(identity.emailVerified, true);
  assert.deepEqual(identity.amr, ["pwd"]);
  assert.equal(identity.ghsRole, "player");
});

test("validateAndRotateRefreshToken accepts a fresh token once, then rejects reuse", async () => {
  const refreshTokens = fakeRefreshTokens();
  const provider = createLocalAuthProvider(config, refreshTokens);
  const tokens = await provider.issueTokens(fakeUser, ["pwd"]);

  const userId = await provider.validateAndRotateRefreshToken(tokens.refreshToken);
  assert.equal(userId, fakeUser.id);

  // Reuse of the same (now-rotated) token must fail.
  await assert.rejects(() => provider.validateAndRotateRefreshToken(tokens.refreshToken));
});

test("reuse of a rotated token revokes every session outstanding at that moment (not sessions issued afterward)", async () => {
  const refreshTokens = fakeRefreshTokens();
  const provider = createLocalAuthProvider(config, refreshTokens);

  // Two concurrent sessions for the same user (e.g. two devices).
  const sessionA = await provider.issueTokens(fakeUser, ["pwd"]);
  const sessionB = await provider.issueTokens(fakeUser, ["pwd"]);

  // Session A refreshes normally, rotating its token.
  await provider.validateAndRotateRefreshToken(sessionA.refreshToken);

  // Reusing the now-rotated session A token is the theft/replay signal --
  // it must revoke session B too, which was outstanding at that moment,
  // even though session B's own token was never itself reused.
  await assert.rejects(() => provider.validateAndRotateRefreshToken(sessionA.refreshToken));
  await assert.rejects(() => provider.validateAndRotateRefreshToken(sessionB.refreshToken));

  // A session issued fresh AFTER the revocation event is a legitimate new
  // login, not something reuse-detection should also block.
  const sessionC = await provider.issueTokens(fakeUser, ["pwd"]);
  const userId = await provider.validateAndRotateRefreshToken(sessionC.refreshToken);
  assert.equal(userId, fakeUser.id);
});

test("validateAndRotateRefreshToken rejects an unknown token", async () => {
  const provider = createLocalAuthProvider(config, fakeRefreshTokens());
  await assert.rejects(() => provider.validateAndRotateRefreshToken("not-a-real-token"));
});

test("MFA-pending token round-trips and is rejected as an access token", async () => {
  const provider = createLocalAuthProvider(config, fakeRefreshTokens());

  const pendingToken = provider.issueMfaPendingToken(fakeUser.id);
  assert.equal(provider.verifyMfaPendingToken(pendingToken), fakeUser.id);

  // An MFA-pending token must never be usable as a real access token --
  // proves the tokenType discriminator actually gates this, not just the
  // signature.
  assert.throws(() => provider.verifyAccessToken(pendingToken));
});

test("an access token is rejected by verifyMfaPendingToken", async () => {
  const provider = createLocalAuthProvider(config, fakeRefreshTokens());
  const tokens = await provider.issueTokens(fakeUser, ["pwd"]);

  assert.throws(() => provider.verifyMfaPendingToken(tokens.accessToken));
});
