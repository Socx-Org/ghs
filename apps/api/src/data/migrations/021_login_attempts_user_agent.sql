-- ghs#236: the raw User-Agent request header, captured alongside
-- ip_address -- a forensic breadcrumb for an admin reviewing their own
-- account's history ("I don't use Linux/curl"), not a trust/security
-- control (trivially spoofable, same as ip_address already is). Nullable:
-- a request missing the header (e.g. a bare curl call with it stripped)
-- is a real absence, not an error.
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS user_agent TEXT;
