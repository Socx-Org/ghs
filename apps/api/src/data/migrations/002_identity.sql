-- Phase 1 (ghs#8) -- identity (users), profile (players), and supporting
-- token/MFA tables. Implements IAM-020 (socx-platform), ADR-120's
-- follow-on work: users/players/role strictly separated (IAM-020),
-- argon2 password hashing (ADR-120's platform standard), status enum
-- richer than legacy GHS's bare boolean (borrowing RMS's real user_status
-- shape, extended with pending_verification).

CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              CITEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending_verification'
                        CHECK (status IN ('pending_verification', 'active', 'disabled', 'deleted')),
  role               TEXT NOT NULL DEFAULT 'player'
                        CHECK (role IN ('player', 'admin', 'super_admin')),
  email_verified_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Domain profile, kept strictly separate from identity (IAM-020) --
-- club_id references ghs#7's clubs table; user_id is nullable (a real,
-- preserved legacy business case: an admin can pre-register a player who
-- has no login yet).
CREATE TABLE IF NOT EXISTS players (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  club_id      UUID REFERENCES clubs(id) ON DELETE SET NULL,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  middle_name  TEXT,
  dob          DATE,
  gender       TEXT CHECK (gender IS NULL OR gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
  country      CHAR(2) NOT NULL DEFAULT 'GB',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_user_id_unique_active
  ON players(user_id) WHERE deleted_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_players_club_id ON players(club_id) WHERE deleted_at IS NULL;

-- Adopted from legacy GHS's own real, sound pattern: hashed token,
-- expiry, single-use via used_at.
CREATE TABLE IF NOT EXISTS account_activation_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aat_user_id ON account_activation_tokens(user_id);

-- Same pattern, + one improvement over legacy: every other outstanding
-- reset token for a user is invalidated when one is successfully used
-- (enforced in the application layer, not here).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);

-- Refresh-token rotation/revocation state: database-backed, not Redis
-- (platform owner decision, 2026-08-10) -- no new infrastructure
-- dependency, same shape as the activation/reset token tables above.
-- rotated_at is set the moment a refresh token is exchanged for a new
-- pair (single-use); revoked_at covers explicit logout/admin action.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  rotated_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Extensible beyond TOTP by design (IAM-020) -- only 'totp' built now.
-- secret is ENCRYPTED, not hashed (see application-layer crypto.ts) --
-- verifying a code requires the raw secret, unlike every other credential
-- this schema stores.
CREATE TABLE IF NOT EXISTS user_mfa_methods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method      TEXT NOT NULL CHECK (method IN ('totp')),
  secret      TEXT NOT NULL,
  enabled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, method)
);

CREATE TABLE IF NOT EXISTS user_mfa_backup_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user_id ON user_mfa_backup_codes(user_id);
