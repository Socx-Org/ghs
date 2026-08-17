-- ghs#58 (Phase 6a) -- explicit player-editable draft state, so that
-- creating a round no longer means submitting it for admin review.
--
-- 'draft': a new round status, distinct from 'pending' -- "player is
-- still entering scores" vs. "player has explicitly submitted for
-- review" are now different states, not the same one. Without this,
-- every round ever created (even with zero holes entered) sat in the
-- same admin approval queue as a genuinely finished submission.
--
-- The application layer (rounds.service.ts) now inserts new rounds with
-- status = 'draft' explicitly, but the column default is updated too
-- (defense in depth / correctness of the schema's own truth, not just
-- the one current caller) -- 'pending' as a default no longer matches
-- intended behaviour regardless of how many INSERT paths exist today.
DO $$
BEGIN
  ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
  ALTER TABLE rounds ADD CONSTRAINT rounds_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'amending'));
END
$$;

ALTER TABLE rounds ALTER COLUMN status SET DEFAULT 'draft';
