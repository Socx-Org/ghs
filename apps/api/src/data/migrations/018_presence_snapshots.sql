-- ghs#195: periodic aggregate-only snapshots of countActiveNow(), so the
-- Admin Dashboard's "Active right now" widget can render a sparkline over
-- time. Deliberately aggregate-only (snapshot_at + active_count) -- the
-- prior design review already rejected exposing *who* is active as a
-- materially different, more sensitive feature than a bare count
-- (users.repository.ts's own countActiveNow doc comment); this table
-- carries that same constraint forward, never a per-user row.
CREATE TABLE IF NOT EXISTS presence_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at TIMESTAMPTZ NOT NULL,
  active_count INTEGER NOT NULL
);

-- Every query against this table is a range scan on snapshot_at (bucketing
-- into 24h/week/month windows for the sparkline) -- never a NULL here
-- (unlike 016_user_presence.sql's last_active_at), so a plain, non-partial
-- index is the right shape.
CREATE INDEX IF NOT EXISTS idx_presence_snapshots_snapshot_at ON presence_snapshots(snapshot_at);
