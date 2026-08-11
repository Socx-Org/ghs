-- Phase 2 (ghs#19) -- PCC (Playing Conditions Calculation), a real,
-- per-tee-configuration-per-day WHS calculation, not a single global
-- admin override. Discovery (2026-08-11) found legacy's actual
-- differential/PCC engine (services/pcc.ts) exclusively uses this
-- per-tee-per-day mechanism -- system_settings.pcc_override (ported in
-- ghs#11) was confirmed dead configuration, never consumed by any real
-- calculation, and is removed by this migration rather than repurposed
-- (platform owner decision, 2026-08-12).

ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS pcc SMALLINT CHECK (pcc IS NULL OR pcc BETWEEN -1 AND 3);

CREATE TABLE IF NOT EXISTS tee_configuration_daily_pcc (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tee_configuration_id  UUID NOT NULL REFERENCES tee_configurations(id) ON DELETE CASCADE,
  played_on             DATE NOT NULL,
  pcc                   SMALLINT NOT NULL CHECK (pcc BETWEEN -1 AND 3),
  source                TEXT NOT NULL DEFAULT 'calculated' CHECK (source IN ('calculated', 'override')),
  -- Who set an override, when it was one -- a real improvement over
  -- legacy, which only logs the acting admin to its audit log, never on
  -- the row itself.
  updated_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tee_configuration_id, played_on)
);

-- Serves the bulk "every round on this tee-configuration/day" lookup
-- calculate/override does, so it's an indexed lookup, not a scan.
CREATE INDEX IF NOT EXISTS idx_rounds_teeconfig_playedat
  ON rounds (tee_configuration_id, played_at);

DELETE FROM system_settings WHERE key = 'pcc_override';
