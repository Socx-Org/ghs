-- ghs#231: session_id lets a login session be tracked across refresh-
-- token rotation without changing how rotation itself works -- generated
-- once at login, copied forward unchanged on every rotation (see
-- auth-provider.ts's own issueTokens). Backfilled to each existing row's
-- own id: a row that hasn't rotated forward yet IS its own session so
-- far, which is exactly the correct starting value -- there is no real
-- history to reconstruct for rows that predate this column.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id UUID;
UPDATE refresh_tokens SET session_id = id WHERE session_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN session_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id ON refresh_tokens(session_id);

-- ghs#231: an append-only audit trail of every login-ESTABLISHING event
-- (POST /auth/login, POST /auth/mfa/verify) -- deliberately NOT every
-- token refresh. A session's continued liveness (active/expired/logged
-- out) is read live off refresh_tokens via session_id at query time
-- (login-attempts.repository.ts), not duplicated into a column here --
-- refresh_tokens.revoked_at/expires_at are already the one real source
-- of truth for that, and logout/reuse-detection already maintain them
-- directly.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The raw submitted (login) or resolved (mfa-complete) email -- kept
  -- even when it matches no real account, since a failed attempt
  -- against a nonexistent email is still a real attempt worth auditing.
  -- CITEXT only for consistent typing with users.email (ghs#8); never
  -- compared against anything here.
  email       CITEXT NOT NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  outcome     TEXT NOT NULL
                CHECK (outcome IN ('success', 'invalid_credentials', 'account_not_active', 'mfa_required', 'invalid_mfa_code')),
  ip_address  TEXT NOT NULL,
  -- Reserved for ghs#232 (geo-IP enrichment) -- always NULL until that
  -- issue wires up a real lookup. Nullable permanently even after that:
  -- a private/local/reserved IP (every dev-environment login) has no
  -- real geo answer.
  country     TEXT,
  region      TEXT,
  city        TEXT,
  -- Set only on a 'success' outcome -- the join key back to
  -- refresh_tokens.session_id. Not a real FK: a session can outlive,
  -- or be queried independently of, any single refresh_tokens row, and
  -- session_id is not unique on that table (one row per rotation).
  session_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at ON login_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_id ON login_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_session_id ON login_attempts(session_id);
