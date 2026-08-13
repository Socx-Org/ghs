-- Phase 4 (ghs#5/ghs#39) -- extends ghs#25's notification_history/
-- notification_outbox for the real delivery worker, and for notifying
-- non-player users.
--
-- notification_history moves from player_id to user_id. Found during
-- Phase 4 discovery: UserRole is 'player' | 'admin' | 'super_admin', and
-- players.user_id is itself nullable (a player profile can exist with no
-- linked login) -- an admin-invited admin/super_admin account has no
-- player row at all (adminCreateUser only creates one when
-- input.role === 'player'). The player-scoped schema ghs#25 shipped
-- cannot represent "notify this admin their account was created" at
-- all. Every real notification recipient is fundamentally a user; a
-- player is a user who also happens to have a player profile, not the
-- other way around.
--
-- Existing rows (all five ghs#25 triggers are player-scoped) are
-- backfilled via players.user_id. A player with no linked user account
-- was never actually notifiable in the first place (no email address
-- exists anywhere for them -- Player has no email field, only
-- users.email) -- any such orphaned row is deleted here rather than left
-- with a NULL user_id, consistent with the "skip, don't error" handling
-- the application layer now applies going forward for the same case.
-- notification_outbox rows cascade-delete with their parent history row.
ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

UPDATE notification_history nh
SET user_id = p.user_id
FROM players p
WHERE nh.player_id = p.id AND nh.user_id IS NULL;

DELETE FROM notification_history WHERE user_id IS NULL;

ALTER TABLE notification_history ALTER COLUMN user_id SET NOT NULL;

-- player_id itself is deliberately deprecated in place, not dropped:
-- apply.ts (ADR-200) re-runs every migration file's full text on every
-- application, relying entirely on IF EXISTS/IF NOT EXISTS for
-- idempotency -- there is no schema_migrations "already applied" tracking
-- table. 009 (already shipped/applied to production in ghs#25) contains
-- an unconditional `CREATE INDEX IF NOT EXISTS
-- idx_notification_history_player_created ON
-- notification_history(player_id, ...)`, which is only idempotent so
-- long as both the index name AND the player_id column it indexes
-- continue to exist. Dropping the column here would make every
-- subsequent full re-application fail on 009's own statement -- and 009
-- must not be edited after having already been applied elsewhere (ADR-200:
-- migrations are an immutable, append-only record of what actually ran).
-- Application code no longer reads or writes player_id (see
-- notifications.repository.ts) -- dropping NOT NULL is what actually
-- matters so new inserts (which only ever set user_id) succeed.
ALTER TABLE notification_history ALTER COLUMN player_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_user_created
  ON notification_history(user_id, created_at DESC);

-- event_type CHECK extended with the four remaining real notification
-- paths, found by direct search of auth.service.ts/admin-users.service.ts
-- (both previously logged the raw activation/reset token in plaintext as
-- a delivery placeholder -- a real, pre-existing SEC-010-adjacent issue
-- fixed by migrating these call sites to the real outbox, not scope
-- creep introduced by this issue).
DO $$
BEGIN
  ALTER TABLE notification_history DROP CONSTRAINT IF EXISTS notification_history_event_type_check;
  ALTER TABLE notification_history ADD CONSTRAINT notification_history_event_type_check
    CHECK (event_type IN (
      'round_submitted', 'round_approved', 'round_rejected', 'handicap_changed', 'manual_override',
      'account_activation', 'account_activation_resend', 'password_reset', 'account_activation_admin_invite'
    ));

  ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_event_type_check;
  ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_event_type_check
    CHECK (event_type IN (
      'round_submitted', 'round_approved', 'round_rejected', 'handicap_changed', 'manual_override',
      'account_activation', 'account_activation_resend', 'password_reset', 'account_activation_admin_invite'
    ));
END
$$;

-- notification_outbox's real delivery lifecycle (ADR-210's own state
-- model, points 4/5/7) -- ghs#25 deliberately left these out ("nothing
-- in this issue's code ever transitions a row out of 'pending' -- there
-- is no worker yet"); ghs#39/ghs#42 are that worker.
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
-- retry_after: NULL means "eligible now" (a fresh pending row, or a
-- permanently failed one -- retry_after is meaningless once status is
-- 'failed'). Set to a future timestamp only for a retryable failure
-- currently waiting out its backoff delay.
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;
-- failure_reason: the classified reason for the most recent attempt's
-- failure (retryable or permanent) -- observability (ADR-210 point 9),
-- deliberately never the raw provider response body (SEC-010 -- a
-- provider error can echo back the message content it was asked to
-- send).
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- The worker's real claiming query filters on status='pending' AND
-- (retry_after IS NULL OR retry_after <= now()) -- index covers both.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_retry
  ON notification_outbox(status, retry_after);
