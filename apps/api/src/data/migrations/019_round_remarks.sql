-- ghs#215: a free-text field for miscellaneous round information --
-- nullable, no length limit, matching rounds.rejection_reason's own
-- precedent (the only other free-text column on this table, itself
-- unbounded).
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS remarks TEXT;
