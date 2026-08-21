-- ghs#100 review fix, PR #141: listAdminRounds (GET /admin/rounds)
-- orders by played_at DESC, id -- neither existing rounds index
-- supports this (idx_rounds_player_played_at and
-- idx_rounds_teeconfig_playedat are both scoped to a specific
-- player/tee configuration, not the general admin browser's
-- no-filter/status-only case), so this query would require a full
-- scan + sort as the table grows.
--
-- Two indexes, matching the two real query shapes listAdminRounds
-- actually runs: no status filter (or only playerId), and a status
-- filter. Partial (WHERE deleted_at IS NULL) to match every other
-- soft-delete index already in this schema (idx_players_club_id,
-- idx_courses_club_id/city/country, idx_tee_configurations_deleted_at)
-- -- every one of listAdminRounds' own queries already filters on
-- deleted_at IS NULL, so a full index only wastes space on rows no
-- query here will ever match.
CREATE INDEX IF NOT EXISTS idx_rounds_played_at_admin
  ON rounds(played_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rounds_status_played_at_admin
  ON rounds(status, played_at DESC, id) WHERE deleted_at IS NULL;
