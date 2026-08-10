-- Phase 1 (ghs#9) -- rounds and hole_scores: the structure Phase 2's WHS
-- handicap calculation and round-approval workflow build on. Schema and
-- basic repository CRUD only -- approval *behaviour* (recalculation,
-- notification) is explicitly Phase 2's scope, not built here.
--
-- Hole-count per round is deliberately NOT enforced here (open question
-- resolved 2026-08-10, ghs#9): real gameplay requires incremental,
-- hole-by-hole entry, so a round in progress legitimately has fewer than
-- 18 (or 9) hole_scores rows. Completeness-before-submission belongs to
-- Phase 2's workflow, not this schema. Legacy's own choice here
-- (UNIQUE(round_id, hole_number) only, no count) is kept on that basis,
-- not merely carried forward by default.

CREATE TABLE IF NOT EXISTS rounds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  tee_configuration_id  UUID NOT NULL REFERENCES tee_configurations(id) ON DELETE RESTRICT,
  played_at             TIMESTAMPTZ NOT NULL,
  playing_handicap      NUMERIC(5,2),
  gross_score           INTEGER CHECK (gross_score IS NULL OR gross_score >= 0),
  adjusted_gross_score  INTEGER CHECK (adjusted_gross_score IS NULL OR adjusted_gross_score >= 0),
  score_differential    NUMERIC(6,3),
  total_putts           INTEGER CHECK (total_putts IS NULL OR total_putts >= 0),
  total_gir             INTEGER CHECK (total_gir IS NULL OR total_gir >= 0),
  total_fairways_hit    INTEGER CHECK (total_fairways_hit IS NULL OR total_fairways_hit >= 0),
  total_penalties       INTEGER CHECK (total_penalties IS NULL OR total_penalties >= 0),
  is_tournament         BOOLEAN NOT NULL DEFAULT FALSE,
  is_9_hole             BOOLEAN NOT NULL DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rounds_player_played_at ON rounds(player_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_tee_configuration_id ON rounds(tee_configuration_id);

-- fairway_result: deliberate redesign (ghs#9, platform owner requirement,
-- 2026-08-10) -- three-state text, not the legacy boolean fairway_hit.
-- Nullable: not applicable/not recorded (e.g. par-3 holes with no real
-- tee-shot fairway). TEXT + CHECK, matching this schema's existing
-- convention for small fixed vocabularies (users.status/role,
-- players.gender, user_mfa_methods.method) rather than a native Postgres
-- ENUM. One field, not fairway_hit BOOLEAN plus a separate miss_side
-- column -- two fields would allow a contradictory state unless a second
-- CHECK tied them together.
CREATE TABLE IF NOT EXISTS hole_scores (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id                   UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  hole_number                SMALLINT NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  strokes                    SMALLINT NOT NULL CHECK (strokes >= 1),
  putts                      SMALLINT CHECK (putts IS NULL OR putts >= 0),
  gir                        BOOLEAN NOT NULL DEFAULT FALSE,
  fairway_result             TEXT CHECK (fairway_result IS NULL OR fairway_result IN ('hit', 'missed_left', 'missed_right')),
  in_sand                    BOOLEAN NOT NULL DEFAULT FALSE,
  penalties                  SMALLINT NOT NULL DEFAULT 0 CHECK (penalties >= 0),
  net_double_bogey_adjusted  SMALLINT NOT NULL DEFAULT 0 CHECK (net_double_bogey_adjusted >= 0),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hole_scores_round_hole_unique ON hole_scores(round_id, hole_number);
CREATE INDEX IF NOT EXISTS idx_hole_scores_round_id ON hole_scores(round_id);
