-- Phase 1 (ghs#11) -- system_settings, deliberately built to APP-020's
-- (Approved) Configuration Management pattern: a single generic key/value
-- table, not legacy GHS's fixed-column singleton row.
--
-- This is an intentional validation of APP-020 as a cross-application
-- platform pattern, not an accident of convenience -- legacy's schema had
-- database-level CHECK constraints (e.g. pcc_override BETWEEN -1 AND 3)
-- this shape cannot express the same way. That constraint is not
-- weakened or dropped: it is relocated to the application layer
-- (system-settings.service.ts), enforced at every write path, with
-- automated tests proving it (platform owner decision, 2026-08-10).

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
