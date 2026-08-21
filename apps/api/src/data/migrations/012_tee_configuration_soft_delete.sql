-- ghs#99: standalone tee-configuration update/delete needs its own
-- soft-delete marker -- tee_configurations had no deleted_at column at
-- all until now (only courses/clubs did), confirmed by direct schema
-- inspection. Deleting a tee configuration a round already references
-- (rounds.tee_configuration_id ON DELETE RESTRICT, migration 004) must
-- never actually remove the row -- historical rounds keep needing its
-- hole/rating data for scoring -- so this is a soft-delete, matching
-- the existing courses/clubs convention exactly, not a new pattern.
ALTER TABLE tee_configurations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tee_configurations_deleted_at ON tee_configurations(deleted_at) WHERE deleted_at IS NULL;
