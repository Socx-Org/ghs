-- ghs#177 (design doc sections C/J.2/L.5/L.6): real presence tracking
-- for the Admin Dashboard's "Active Right Now" widget. Nullable --
-- null means "has never sent a heartbeat" (e.g. every existing user at
-- migration time, or a freshly-created account before its first
-- authenticated page load), distinct from a real, stale timestamp.
--
-- The index is not optional (see the issue's own scope note): this
-- column is written to by every open, focused, authenticated tab
-- roughly once a minute (ghs#179's heartbeat hook) and read as a range
-- condition on every admin dashboard poll (ghs#180's "active right
-- now" count) -- skipping it means a sequential scan on a column under
-- constant write load, on a table (`users`) already touched by every
-- authenticated request path in the app.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- Partial (review finding, PR #185): every user starts (and many stay)
-- NULL until their first heartbeat, and countActiveNow's own query
-- (`last_active_at > now() - INTERVAL '5 minutes'`) can only ever match
-- a non-NULL row -- indexing the NULLs too would waste space for zero
-- query coverage. Same convention as the admin-rounds partial indexes
-- (015_admin_rounds_index.sql's own WHERE deleted_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_users_last_active_at ON users(last_active_at) WHERE last_active_at IS NOT NULL;
