-- Phase 2 (ghs#21) -- resolves the deliberate deferral left in ghs#10's
-- own commit: "a WHS handicap index is an inherently derived value...
-- whether/how a 'current' index is cached or computed on demand is
-- Phase 2's concern."
--
-- handicap_history is deliberately NOT a copy of legacy's
-- handicap_records. Legacy stuffs override-specific metadata (method,
-- reason, adminUserId) into the cap_adjustments JSONB column as a
-- workaround for its single-purpose flat schema. Here, a shared core
-- (method, handicap_index, previous_index, reason, created_by) is always
-- populated regardless of source, and calculation_snapshot -- the
-- differentials/rounds/PCC/cap detail a calculated result needs to
-- explain itself -- is populated only when method='calculated'.
--
-- handicap_overrides (ghs#10) is not merged into or replaced by this
-- table: it remains the admin-action audit log (who, why); this is the
-- index-value timeline. Both write here through one shared repository
-- function (handicap-history.repository.ts), not two independent paths.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS handicap_index NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS low_handicap_index NUMERIC(4,1);

CREATE TABLE IF NOT EXISTS handicap_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  method                TEXT NOT NULL CHECK (method IN ('calculated', 'manual_override')),
  handicap_index        NUMERIC(4,1) NOT NULL,
  previous_index        NUMERIC(4,1),
  reason                TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  calculation_snapshot  JSONB,
  calculation_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT handicap_history_reason_required_for_override
    CHECK (method <> 'manual_override' OR reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_handicap_history_player_date
  ON handicap_history(player_id, calculation_date DESC);
