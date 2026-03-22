-- ============================================================
-- Migration 001: Core Tables
-- Project: Alfanumrik
-- Description: Extensions, helper functions, user tables,
--              content tables, and updated_at trigger.
-- ============================================================


-- ============================================================
-- SECTION 1: Extensions
-- ============================================================

-- pgcrypto: provides gen_random_uuid() and cryptographic helpers
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgcrypto extension not available: %', SQLERRM;
END;
$$;

-- pg_net: enables async HTTP requests from SQL / Edge Functions
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net extension not available: %', SQLERRM;
END;
$$;


-- ============================================================
-- SECTION 2: Helper Functions
-- ============================================================

-- Returns the students.id that belongs to the currently
-- authenticated Supabase auth user.
CREATE OR REPLACE FUNCTION get_student_id_for_auth()
RETURNS UUID AS $$
  SELECT id FROM students WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Returns TRUE if the currently authenticated user is an
-- active guardian of the given student.
CREATE OR REPLACE FUNCTION is_guardian_of(p_student_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1
    FROM guardian_student_links gsl
    JOIN guardians g ON g.id = gsl.guardian_id
    WHERE gsl.student_id = p_student_id
      AND g.auth_user_id  = auth.uid()
      AND gsl.status      = 'active'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Returns TRUE if the currently authenticated user is a
-- teacher of any class the given student is enrolled in.
CREATE OR REPLACE FUNCTION is_teacher_of(p_student_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1
    FROM class_enrollments ce
    JOIN classes  c ON c.id  = ce.class_id
    JOIN teachers t ON t.id  = c.teacher_id
    WHERE ce.student_id   = p_student_id
      AND t.auth_user_id  = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ============================================================
-- SECTION 3: Core User Tables
-- ============================================================

-- ------------------------------------------------------------
-- students
-- Primary learner account. Linked 1-to-1 with auth.users.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id       UUID        UNIQUE REFERENCES auth.users ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  grade              INT         NOT NULL DEFAULT 6,
  board              TEXT        DEFAULT 'CBSE',
  preferred_language TEXT        DEFAULT 'en',
  avatar_url         TEXT,
  xp                 INT         DEFAULT 0,
  streak             INT         DEFAULT 0,
  preferences        JSONB       DEFAULT '{}',
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- teachers
-- Educator account. Linked 1-to-1 with auth.users.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teachers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    UUID        UNIQUE REFERENCES auth.users ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  school_name     TEXT,
  subjects_taught TEXT[]      DEFAULT '{}',
  grades_taught   INT[]       DEFAULT '{}',
  email           TEXT,
  phone           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- guardians
-- Parent / guardian account. auth_user_id is nullable so a
-- guardian can be invited before they sign up.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardians (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID        REFERENCES auth.users ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  email        TEXT,
  phone        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- guardian_student_links
-- Tracks invite-code-based linkage between guardians and
-- students. Status flows: pending → active | revoked.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_student_links (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID        NOT NULL REFERENCES students  ON DELETE CASCADE,
  guardian_id UUID        NOT NULL REFERENCES guardians ON DELETE CASCADE,
  invite_code TEXT        UNIQUE NOT NULL,
  status      TEXT        DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'revoked')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- classes
-- A teacher-owned class group (e.g. "6A – Maths").
-- class_code is the student-facing join token.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID        NOT NULL REFERENCES teachers ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  grade       INT         NOT NULL,
  section     TEXT,
  subject     TEXT,
  class_code  TEXT        UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- class_enrollments
-- Many-to-many join between classes and students.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_enrollments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    UUID        NOT NULL REFERENCES classes  ON DELETE CASCADE,
  student_id  UUID        NOT NULL REFERENCES students ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (class_id, student_id)
);


-- ============================================================
-- SECTION 4: Content Tables
-- ============================================================

-- ------------------------------------------------------------
-- subjects
-- Master list of subjects available on the platform.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT        UNIQUE NOT NULL,
  name          TEXT        NOT NULL,
  icon          TEXT,
  color         TEXT,
  is_active     BOOLEAN     DEFAULT true,
  display_order INT         DEFAULT 0
);

-- ------------------------------------------------------------
-- curriculum_topics
-- Hierarchical curriculum tree. parent_topic_id enables
-- chapters to contain sub-topics.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_topics (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      UUID        REFERENCES subjects ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  grade           INT         NOT NULL,
  chapter_number  INT,
  parent_topic_id UUID        REFERENCES curriculum_topics(id),
  bloom_focus     TEXT,
  is_active       BOOLEAN     DEFAULT true,
  display_order   INT         DEFAULT 0
);

-- ------------------------------------------------------------
-- interactive_simulations
-- Embeddable widgets / iframes tied to curriculum concepts.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interactive_simulations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_code TEXT        NOT NULL,
  grade        INT         NOT NULL,
  widget_code  TEXT        NOT NULL,
  widget_type  TEXT        DEFAULT 'iframe',
  concept_tags TEXT[]      DEFAULT '{}',
  title        TEXT        NOT NULL,
  description  TEXT,
  thumbnail_url TEXT,
  is_active    BOOLEAN     DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- SECTION 5: updated_at Trigger
-- ============================================================

-- Generic trigger function that stamps updated_at on any row change.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to students (the only core table with updated_at).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname   = 'trg_students_updated_at'
      AND tgrelid  = 'students'::regclass
  ) THEN
    CREATE TRIGGER trg_students_updated_at
      BEFORE UPDATE ON students
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
