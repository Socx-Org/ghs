-- Phase 2 (ghs#25) -- domain notification triggers and the transactional
-- outbox write path, per ADR-210 point 1 (the outbox record MUST be
-- created in the same database transaction as the business operation
-- that triggers it) and its "history vs. outbox" decision (kept as two
-- separate tables, linked by a foreign key, not merged -- see ADR-210's
-- "Notification history vs. outbox" section for the full rationale).
--
-- ADR-210 describes legacy GHS as already having a notification_history
-- table with an existing 'skipped' status. That table does not exist
-- anywhere in this rebuild -- confirmed by search before writing this
-- migration -- so both tables are created here together, not just the
-- outbox ADR-210's own migration acceptance criterion names. There is no
-- 'skipped' status in this issue's scope: this issue implements a fixed
-- trigger table with no preference-gating logic (see rounds.service.ts/
-- recalculation.service.ts/handicap-overrides.service.ts), so every
-- notification_history row this issue ever writes always has a
-- corresponding outbox row -- a status column recording that would
-- always hold the same single value, so it's left out rather than added
-- speculatively for a gating mechanism this issue doesn't build.
--
-- Both tables carry their own event_type/payload rather than the outbox
-- joining back to history for them: the worker (ghs#5, a later phase)
-- needs the payload to actually send, and per ADR-210's own retention
-- discussion, the outbox and history rows are expected to plausibly need
-- different retention periods -- duplicating the small, already-decided
-- payload avoids coupling the outbox's future pruning to the history
-- row still existing.

CREATE TABLE IF NOT EXISTS notification_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_history_player_created
  ON notification_history(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_history_id UUID NOT NULL REFERENCES notification_history(id) ON DELETE CASCADE,
  event_type               TEXT NOT NULL,
  payload                  JSONB NOT NULL,
  -- Minimal shape per this issue's own acceptance criteria -- no
  -- retry_after/attempts/failure-classification columns. Those are
  -- ADR-210 points 4/5, added by ghs#5 (the delivery worker, a later
  -- phase) via its own migration when a real worker needs them. Nothing
  -- in this issue's code ever transitions a row out of 'pending' --
  -- there is no worker yet to claim or send one.
  status                    TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The worker's future claiming query (ghs#5): "give me pending rows" --
-- indexed now since the shape is already fixed, even though nothing
-- queries it yet.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status
  ON notification_outbox(status);
