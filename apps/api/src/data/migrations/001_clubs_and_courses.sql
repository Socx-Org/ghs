-- Phase 1 (Domain Data Model) -- clubs, courses, tee configurations, holes.
-- Replaces Phase 0's widgets stand-in. ADR-200: versioned, applied-in-order
-- SQL migration files; no specific migration tool mandated.
--
-- clubs is a real entity -- not carried forward from legacy GHS (which had
-- none), but evidenced directly: the CSV export data showed a single real
-- club (La Manga) with two separately named courses (North, South), which
-- legacy's course-doubles-as-club schema cannot represent.

CREATE TABLE IF NOT EXISTS clubs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  city       TEXT,
  country    CHAR(2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_name_country_unique
  ON clubs (LOWER(name), country)
  WHERE deleted_at IS NULL;

-- club_id is nullable -- open question resolved 2026-08-10 (ghs#7): no
-- legacy evidence requires every course to belong to a formally modelled
-- club, and a course with no membership structure is a plausible real
-- case. Nullable is the reversible default; tightening later is safe.
CREATE TABLE IF NOT EXISTS courses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    UUID REFERENCES clubs(id) ON DELETE RESTRICT,
  name       TEXT NOT NULL,
  address    TEXT,
  city       TEXT,
  country    CHAR(2),
  phone      TEXT,
  email      TEXT,
  website    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_courses_club_id ON courses(club_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_name_country_unique
  ON courses (LOWER(name), country)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_city ON courses(city) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_country ON courses(country) WHERE deleted_at IS NULL;

-- course_rating / slope_rating: real WHS course-rating data (ADR-070's
-- domain, not incidental columns). slope_rating's 55-155 range is the
-- official WHS Slope Rating bound -- a real domain constraint, not
-- invented; legacy's own schema didn't enforce it at the database level,
-- added here as a genuine improvement on its technical merits.
CREATE TABLE IF NOT EXISTS tee_configurations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  hole_count     SMALLINT NOT NULL CHECK (hole_count IN (9, 18)),
  course_rating  NUMERIC(4,1) NOT NULL CHECK (course_rating > 0),
  slope_rating   SMALLINT NOT NULL CHECK (slope_rating BETWEEN 55 AND 155),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tee_configurations_course_id ON tee_configurations(course_id);

CREATE TABLE IF NOT EXISTS holes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tee_configuration_id  UUID NOT NULL REFERENCES tee_configurations(id) ON DELETE CASCADE,
  hole_number           SMALLINT NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  distance_yards        SMALLINT NOT NULL CHECK (distance_yards > 0),
  par                   SMALLINT NOT NULL CHECK (par BETWEEN 3 AND 6),
  stroke_index          SMALLINT NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_holes_tee_config_hole_unique
  ON holes(tee_configuration_id, hole_number);
