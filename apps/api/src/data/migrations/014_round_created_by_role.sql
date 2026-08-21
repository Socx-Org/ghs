-- ghs#100 (Phase 6b refinement): records which role created a round,
-- captured at creation time -- not looked up live from users.role at
-- submission time, since a creator's role can change after the fact,
-- and "who was the person of record entering this round" is a
-- historical fact about that moment, not something that should
-- retroactively shift if the creator's role later changes. Checked
-- before adding a new column: no existing "who created this" concept
-- exists on rounds itself (handicap_history.created_by is the closest
-- precedent elsewhere in the schema, but it's a user-id FK for a
-- different purpose; this only ever needs the role, not the specific
-- user, per this issue's own scope).
--
-- Nullable: every existing round predates this column and has no true
-- value to backfill, so they stay NULL -- which is also exactly the
-- correct, safe default for the auto-approval fast path this supports
-- (NULL never matches 'admin'/'super_admin', so no already-existing
-- round is retroactively auto-approved by this change, matching this
-- issue's own explicit non-scope).
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS created_by_role TEXT
  CHECK (created_by_role IN ('player', 'admin', 'super_admin'));
