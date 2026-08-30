-- ghs#180 review fix, PR #186: getRegistrationTrend's own WHERE
-- created_at >= ... filter had no supporting index -- as the users
-- table grows, this admin-dashboard query path (polled repeatedly,
-- same as ghs#177's Active Right Now) would force a sequential scan
-- over the whole table on every call. Same index-consciousness already
-- established for last_active_at (016_user_presence.sql) and the
-- admin-rounds queries (015_admin_rounds_index.sql).
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
