-- Phase 0 (Foundation) -- illustrative schema for the widgets stand-in
-- resource, adopted from reference/application to prove the scaffold works
-- end-to-end. Replaced by Phase 1's real domain schema (clubs, courses,
-- tee configurations, holes, players, rounds, handicap records).
-- ADR-090 defers the ORM/migration-tool decision; this is a plain SQL file.

CREATE TABLE IF NOT EXISTS widgets (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
