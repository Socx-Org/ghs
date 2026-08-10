-- Phase 1 (ghs#10) -- handicap_overrides: admin capability to manually set
-- a player's handicap index, mandatory reason, full append-only history.
-- Legacy's own design here (append-only, mandatory reason, CASCADE on
-- player / RESTRICT on admin) is already sound and carried forward on its
-- own technical merits, not redesigned.
--
-- Note: legacy GHS's players table stored a live handicap_index column;
-- ghs#8's players table (this schema) does not -- a WHS handicap index is
-- an inherently derived value, and whether/how a "current" index is
-- cached or computed on demand is Phase 2's concern (the WHS calculation
-- logic), not this issue's. previous_index is therefore an explicit input
-- to this table's create(), provided by the caller, not looked up from a
-- "current handicap" column that doesn't exist in this schema.

CREATE TABLE IF NOT EXISTS handicap_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  admin_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_index NUMERIC(4,1),
  new_index      NUMERIC(4,1) NOT NULL,
  reason         TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handicap_overrides_player_id ON handicap_overrides(player_id, created_at DESC);
