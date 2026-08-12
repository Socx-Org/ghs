-- Phase 2 (ghs#23) -- round approval, rejection, and amendment workflow.
--
-- 'amending': a new round status, distinct from 'pending', so "awaiting
-- first approval" and "was approved, now under correction" remain
-- distinguishable in the audit trail and any UI. An approved round is
-- not silently mutable (legacy allows unconditional overwrite of any
-- round regardless of status -- not preserved); correcting one requires
-- an explicit reopen (mandatory reason), landing here, before hole
-- scores can be edited again.
--
-- rounds.deleted_at: soft delete, matching the existing players/clubs
-- convention (Phase 1) -- legacy has this; GHS's Phase 1 rounds table
-- did not yet.
DO $$
BEGIN
  ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
  ALTER TABLE rounds ADD CONSTRAINT rounds_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'amending'));
END
$$;

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
