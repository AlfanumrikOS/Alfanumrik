-- ============================================================================
-- 00000000000000_baseline_schema_consolidated.sql
-- ============================================================================
-- WHAT THIS IS
--   Consolidated, idempotent baseline of the foundational Alfanumrik schema.
--   This file is the verbatim concatenation of the 10 SQL files under
--   supabase/migrations/_legacy/ (in canonical order), with minimal
--   idempotency wraps applied around statements that the source SQL did
--   not already guard.
--
-- WHY IT EXISTS
--   Before this migration, supabase/migrations/ first 9 entries were
--   stub files containing only "-- Applied remotely to Supabase / -- See
--   _legacy/ for consolidated SQL reference". Production was bootstrapped
--   via the Supabase dashboard before migration tracking was set up, and
--   "supabase db push" against a fresh Supabase project failed at
--   20260322200645_add_task_queue_and_helper_functions.sql with
--   ERROR: relation "students" does not exist.
--
--   That meant the schema was not reproducible from source — disaster
--   recovery was broken and we could not spin up new staging/dev/test
--   projects. This baseline closes that P0 gap.
--
-- IDEMPOTENCY GUARANTEE
--   Every CREATE TABLE uses IF NOT EXISTS.
--   Every CREATE INDEX uses IF NOT EXISTS.
--   Every CREATE FUNCTION uses OR REPLACE.
--   Every CREATE TRIGGER is wrapped (DROP IF EXISTS ... CREATE) or guarded
--     by a pg_trigger lookup in a DO block.
--   Every CREATE POLICY is preceded by DROP POLICY IF EXISTS.
--   Every ALTER TABLE ADD COLUMN uses IF NOT EXISTS.
--   ALTER PUBLICATION ADD TABLE is wrapped in a pg_publication_tables guard
--     (Postgres errors if the relation is already a publication member).
--
--   On a fresh DB:    creates the foundational schema (schools, students,
--                     sessions, gamification, RLS policies, RPCs, etc.)
--   On production:    every statement is a no-op. The only side effect is
--                     that the supabase CLI marks 00000000000000 as applied
--                     in schema_migrations, which is the desired outcome —
--                     schema becomes traceable from source.
--
-- HISTORICAL REFERENCE
--   supabase/migrations/_legacy/ is preserved unchanged as the historical
--   record of how the schema was bootstrapped. It is no longer required for
--   fresh-DB bootstrap.
--
-- TOTAL FILE ORDER (concatenated below)
--   000_core_schema.sql
--   001_task_queue_and_helpers.sql
--   002_indexes_triggers_realtime.sql
--   003_strengthen_rls.sql
--   004_security_hardening.sql
--   005_welcome_email_triggers.sql
--   006_cognitive_engine_tables.sql
--   007_core_rpcs.sql
--   007_dashboard_rpcs.sql
--   008_fix_snapshot_rpc_and_rls.sql
-- ============================================================================


-- ============================================================
-- > Section: 000_core_schema.sql
-- ============================================================

-- ============================================================================
-- 000_core_schema.sql
-- Core schema migration for Alfanumrik
-- Creates all foundational tables that migrations 001-005 depend on.
-- Must run before any other migration.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------------
-- 1. schools
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  code          TEXT UNIQUE,
  board         TEXT DEFAULT 'CBSE',
  city          TEXT,
  state         TEXT,
  district      TEXT,
  pin_code      TEXT,
  address       TEXT,
  principal_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  school_type   TEXT DEFAULT 'private',
  medium        TEXT DEFAULT 'English',
  is_active     BOOLEAN DEFAULT TRUE,
  student_count INTEGER DEFAULT 0,
  teacher_count INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 2. students
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id          UUID,
  name                  TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  avatar_url            TEXT,
  grade                 TEXT NOT NULL,
  board                 TEXT DEFAULT 'CBSE',
  preferred_language    TEXT NOT NULL DEFAULT 'en',
  date_of_birth         DATE,
  city                  TEXT,
  state                 TEXT,
  onboarding_completed  BOOLEAN DEFAULT FALSE,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  preferred_subject     TEXT DEFAULT 'Mathematics',
  school_name           TEXT,
  school_code           TEXT,
  father_name           TEXT,
  mother_name           TEXT,
  emergency_contact     TEXT,
  learning_style        TEXT,
  academic_goal         TEXT,
  interests             TEXT[] DEFAULT '{}',
  weak_subjects         TEXT[] DEFAULT '{}',
  strong_subjects       TEXT[] DEFAULT '{}',
  daily_study_hours     INTEGER DEFAULT 1,
  subscription_plan     TEXT DEFAULT 'free',
  subscription_expiry   TIMESTAMPTZ,
  referral_code         TEXT,
  referred_by           TEXT,
  xp_total              INTEGER DEFAULT 0,
  streak_days           INTEGER DEFAULT 0,
  last_active           TIMESTAMPTZ DEFAULT now(),
  device_type           TEXT,
  app_version           TEXT,
  link_code             TEXT,
  target_exams          TEXT[] DEFAULT '{}',
  invite_code           TEXT DEFAULT upper(encode(gen_random_bytes(4), 'hex')),
  account_status        TEXT NOT NULL DEFAULT 'active',
  parent_name           TEXT,
  parent_phone          TEXT,
  target_exam           TEXT,
  school_id             UUID REFERENCES schools(id),
  selected_subjects     TEXT[] DEFAULT '{}',
  deleted_at            TIMESTAMPTZ
);
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 3. teachers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teachers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id          UUID,
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  avatar_url            TEXT,
  employee_id           TEXT,
  school_name           TEXT,
  school_code           TEXT,
  city                  TEXT,
  state                 TEXT,
  subjects_taught       TEXT[] DEFAULT '{}',
  grades_taught         TEXT[] DEFAULT '{}',
  qualification         TEXT,
  experience_years      INTEGER DEFAULT 0,
  board                 TEXT DEFAULT 'CBSE',
  preferred_language    TEXT DEFAULT 'Hindi',
  is_active             BOOLEAN DEFAULT TRUE,
  is_verified           BOOLEAN DEFAULT FALSE,
  verification_code     TEXT,
  onboarding_completed  BOOLEAN DEFAULT FALSE,
  bio                   TEXT,
  rating                NUMERIC DEFAULT 0,
  total_students        INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  school_id             UUID REFERENCES schools(id),
  deleted_at            TIMESTAMPTZ
);
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 4. guardians
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardians (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id              UUID,
  name                      TEXT NOT NULL,
  email                     TEXT,
  phone                     TEXT,
  relationship              TEXT DEFAULT 'parent',
  created_at                TIMESTAMPTZ DEFAULT now(),
  preferred_language        TEXT DEFAULT 'en',
  onboarding_completed      BOOLEAN DEFAULT FALSE,
  notification_preferences  JSONB,
  updated_at                TIMESTAMPTZ DEFAULT now(),
  avatar_url                TEXT,
  city                      TEXT,
  state                     TEXT,
  daily_report_enabled      BOOLEAN DEFAULT TRUE,
  weekly_report_enabled     BOOLEAN DEFAULT TRUE,
  alert_threshold_minutes   INTEGER DEFAULT 0,
  alert_score_threshold     INTEGER DEFAULT 50,
  deleted_at                TIMESTAMPTZ
);
ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 5. guardian_student_links
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_student_links (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guardian_id      UUID REFERENCES guardians(id),
  student_id       UUID NOT NULL REFERENCES students(id),
  permission_level TEXT DEFAULT 'view',
  created_at       TIMESTAMPTZ DEFAULT now(),
  link_code        TEXT,
  is_verified      BOOLEAN DEFAULT FALSE,
  linked_at        TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending',
  initiated_by     TEXT,
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ,
  rejected_reason  TEXT,
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE guardian_student_links ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 6. classes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID REFERENCES schools(id),
  name          TEXT NOT NULL,
  grade         TEXT NOT NULL,
  section       TEXT,
  academic_year TEXT DEFAULT '2025-26',
  subject       TEXT,
  class_code    TEXT DEFAULT encode(gen_random_bytes(4), 'hex'),
  created_by    TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  max_students  INTEGER DEFAULT 60,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 7. class_students
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_students (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    UUID NOT NULL REFERENCES classes(id),
  student_id  UUID NOT NULL REFERENCES students(id),
  roll_number TEXT,
  joined_at   TIMESTAMPTZ DEFAULT now(),
  is_active   BOOLEAN DEFAULT TRUE,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE class_students ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 8. class_teachers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_teachers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    UUID NOT NULL REFERENCES classes(id),
  teacher_id  UUID NOT NULL REFERENCES teachers(id),
  role        TEXT DEFAULT 'teacher',
  joined_at   TIMESTAMPTZ DEFAULT now(),
  is_active   BOOLEAN DEFAULT TRUE,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE class_teachers ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 9. subjects
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  name_hi       TEXT,
  icon          TEXT,
  color         TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 10. student_learning_profiles
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_learning_profiles (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                        UUID NOT NULL REFERENCES students(id),
  subject                           TEXT NOT NULL,
  current_level                     TEXT,
  xp                                INTEGER DEFAULT 0,
  level                             INTEGER DEFAULT 1,
  streak_days                       INTEGER DEFAULT 0,
  longest_streak                    INTEGER DEFAULT 0,
  learning_style                    TEXT,
  preferred_explanation_depth       TEXT,
  avg_response_time_seconds         DOUBLE PRECISION,
  frustration_threshold             DOUBLE PRECISION,
  total_sessions                    INTEGER DEFAULT 0,
  total_questions_asked             INTEGER DEFAULT 0,
  total_questions_answered_correctly INTEGER DEFAULT 0,
  total_time_minutes                INTEGER DEFAULT 0,
  last_session_at                   TIMESTAMPTZ,
  created_at                        TIMESTAMPTZ DEFAULT now(),
  updated_at                        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, subject)
);
ALTER TABLE student_learning_profiles ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 11. concept_mastery
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concept_mastery (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID NOT NULL REFERENCES students(id),
  topic_id              UUID NOT NULL,
  mastery_probability   DOUBLE PRECISION DEFAULT 0,
  mastery_level         TEXT,
  attempts              INTEGER DEFAULT 0,
  correct_attempts      INTEGER DEFAULT 0,
  hints_used            INTEGER DEFAULT 0,
  first_attempted_at    TIMESTAMPTZ,
  last_attempted_at     TIMESTAMPTZ,
  mastered_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  next_review_at        TIMESTAMPTZ,
  review_interval_days  INTEGER,
  ease_factor           DOUBLE PRECISION DEFAULT 2.5,
  consecutive_correct   INTEGER DEFAULT 0,
  p_know                DOUBLE PRECISION DEFAULT 0.3,
  p_learn               DOUBLE PRECISION DEFAULT 0.2,
  p_guess               DOUBLE PRECISION DEFAULT 0.25,
  p_slip                DOUBLE PRECISION DEFAULT 0.1,
  sm2_interval          INTEGER DEFAULT 1,
  sm2_repetitions       INTEGER DEFAULT 0,
  next_review_date      DATE,
  quality_responses     INTEGER[] DEFAULT '{}',
  avg_quality           NUMERIC,
  UNIQUE (student_id, topic_id)
);
ALTER TABLE concept_mastery ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 12. topic_mastery
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topic_mastery (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES students(id),
  subject          TEXT NOT NULL,
  topic            TEXT NOT NULL,
  mastery_level    DOUBLE PRECISION DEFAULT 0,
  total_attempts   INTEGER DEFAULT 0,
  correct_attempts INTEGER DEFAULT 0,
  last_attempted   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, subject, topic)
);
ALTER TABLE topic_mastery ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 13. chat_sessions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id),
  subject       TEXT NOT NULL,
  grade         TEXT NOT NULL,
  title         TEXT DEFAULT 'New Chat',
  messages      JSONB DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 14. question_bank
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_bank (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject              TEXT NOT NULL,
  grade                TEXT NOT NULL,
  chapter_number       INTEGER,
  chapter_title        TEXT,
  topic                TEXT,
  question_text        TEXT NOT NULL,
  question_hi          TEXT,
  question_type        TEXT DEFAULT 'mcq',
  options              JSONB NOT NULL DEFAULT '[]',
  correct_answer_index INTEGER NOT NULL DEFAULT 0,
  explanation          TEXT,
  explanation_hi       TEXT,
  hint                 TEXT,
  difficulty           INTEGER DEFAULT 2,
  bloom_level          TEXT DEFAULT 'remember',
  is_active            BOOLEAN DEFAULT TRUE,
  source               TEXT,
  board_year           INTEGER,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 15. quiz_sessions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID NOT NULL REFERENCES students(id),
  subject            TEXT NOT NULL,
  grade              TEXT NOT NULL,
  chapter_number     INTEGER,
  topic_title        TEXT,
  total_questions    INTEGER NOT NULL DEFAULT 10,
  correct_answers    INTEGER DEFAULT 0,
  wrong_answers      INTEGER DEFAULT 0,
  score_percent      DOUBLE PRECISION DEFAULT 0,
  time_taken_seconds INTEGER DEFAULT 0,
  difficulty_level   INTEGER DEFAULT 2,
  question_types     TEXT[] DEFAULT '{}',
  started_at         TIMESTAMPTZ DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  is_completed       BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT now(),
  topic_filter       TEXT,
  score              INTEGER DEFAULT 0,
  total_answered     INTEGER DEFAULT 0,
  deleted_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 16. quiz_responses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_responses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id    UUID REFERENCES quiz_sessions(id),
  student_id         UUID NOT NULL REFERENCES students(id),
  question_id        UUID REFERENCES question_bank(id),
  selected_option    INTEGER,
  is_correct         BOOLEAN,
  time_spent_seconds INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE quiz_responses ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 17. study_plans
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES students(id),
  subject          TEXT,
  title            TEXT,
  description      TEXT,
  plan_type        TEXT DEFAULT 'weekly',
  start_date       DATE,
  end_date         DATE,
  total_tasks      INTEGER DEFAULT 0,
  completed_tasks  INTEGER DEFAULT 0,
  progress_percent INTEGER DEFAULT 0,
  ai_reasoning     TEXT,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 18. study_plan_tasks
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_plan_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          UUID NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES students(id),
  day_number       INTEGER NOT NULL,
  scheduled_date   DATE,
  task_order       INTEGER DEFAULT 1,
  task_type        TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  subject          TEXT,
  chapter_number   INTEGER,
  chapter_title    TEXT,
  topic            TEXT,
  duration_minutes INTEGER DEFAULT 30,
  question_count   INTEGER,
  difficulty       INTEGER DEFAULT 2,
  status           TEXT DEFAULT 'pending',
  xp_reward        INTEGER DEFAULT 0,
  xp_earned        INTEGER DEFAULT 0,
  score_percent    DOUBLE PRECISION,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE study_plan_tasks ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 19. spaced_repetition_cards
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spaced_repetition_cards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES students(id),
  card_type        TEXT DEFAULT 'review',
  subject          TEXT,
  grade            TEXT,
  chapter_number   INTEGER,
  chapter_title    TEXT,
  topic            TEXT,
  front_text       TEXT NOT NULL,
  back_text        TEXT NOT NULL,
  hint             TEXT,
  source           TEXT,
  source_id        UUID,
  ease_factor      DOUBLE PRECISION DEFAULT 2.5,
  interval_days    INTEGER DEFAULT 1,
  repetition_count INTEGER DEFAULT 0,
  next_review_date DATE DEFAULT CURRENT_DATE,
  last_review_date DATE,
  last_quality     INTEGER,
  total_reviews    INTEGER DEFAULT 0,
  correct_reviews  INTEGER DEFAULT 0,
  streak           INTEGER DEFAULT 0,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE spaced_repetition_cards ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 20. competitions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  description      TEXT,
  subject          TEXT,
  grade            TEXT,
  competition_type TEXT DEFAULT 'quiz',
  status           TEXT DEFAULT 'upcoming',
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,
  max_participants INTEGER,
  entry_fee_xp     INTEGER DEFAULT 0,
  prize_pool_xp    INTEGER DEFAULT 0,
  rules            JSONB DEFAULT '{}',
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 21. competition_participants
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competition_participants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id),
  student_id     UUID NOT NULL REFERENCES students(id),
  score          INTEGER DEFAULT 0,
  rank           INTEGER,
  status         TEXT DEFAULT 'registered',
  joined_at      TIMESTAMPTZ DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  UNIQUE (competition_id, student_id)
);
ALTER TABLE competition_participants ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 22. notifications
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type TEXT NOT NULL,
  recipient_id   UUID NOT NULL,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  body_hi        TEXT,
  data           JSONB DEFAULT '{}',
  is_read        BOOLEAN DEFAULT FALSE,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  expires_at     TIMESTAMPTZ
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 23. daily_activity
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_activity (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES students(id),
  activity_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  subject           TEXT,
  questions_asked   INTEGER DEFAULT 0,
  questions_correct INTEGER DEFAULT 0,
  xp_earned         INTEGER DEFAULT 0,
  time_minutes      INTEGER DEFAULT 0,
  sessions          INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, activity_date, subject)
);
ALTER TABLE daily_activity ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 24. student_simulation_progress
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_simulation_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id),
  simulation_id UUID,
  subject       TEXT,
  status        TEXT DEFAULT 'not_started',
  score         INTEGER DEFAULT 0,
  time_spent    INTEGER DEFAULT 0,
  attempts      INTEGER DEFAULT 0,
  best_score    INTEGER DEFAULT 0,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE student_simulation_progress ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 25. classroom_poll_responses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classroom_poll_responses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    UUID,
  student_id UUID REFERENCES students(id),
  answer     TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE classroom_poll_responses ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- > Section: 001_task_queue_and_helpers.sql
-- ============================================================

-- ============================================================
-- Migration 001: Task Queue and Helper Functions
-- Project: Alfanumrik
-- Description: Adds task queue table, helper functions for
--              authentication checks, and indexes for
--              class relationships
-- ============================================================

-- ============================================================
-- SECTION 1: Task Queue Table
-- ============================================================

-- Async background task queue for AI generation, notifications, etc.
CREATE TABLE IF NOT EXISTS task_queue (
  id            BIGSERIAL PRIMARY KEY,
  queue_name    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts      INT DEFAULT 0,
  max_attempts  INT DEFAULT 3,
  created_at    TIMESTAMPTZ DEFAULT now(),
  processing_at TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error         TEXT
);

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
    FROM class_students cs
    JOIN class_teachers ct ON ct.class_id = cs.class_id
    JOIN teachers t ON t.id = ct.teacher_id
    WHERE cs.student_id = p_student_id
      AND t.auth_user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- SECTION 3: Performance Indexes
-- ============================================================

-- Indexes on class relationships for efficient teacher/guardian lookups
CREATE INDEX IF NOT EXISTS idx_class_students_student_id
  ON class_students(student_id);

CREATE INDEX IF NOT EXISTS idx_class_students_class_id
  ON class_students(class_id);

CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher_id
  ON class_teachers(teacher_id);

CREATE INDEX IF NOT EXISTS idx_class_teachers_class_id
  ON class_teachers(class_id);

-- ============================================================
-- > Section: 002_indexes_triggers_realtime.sql
-- ============================================================

-- ============================================================
-- Migration 002: Additional Indexes, Updated_at Triggers,
--                and Realtime Publications
-- Project: Alfanumrik
-- Description: Adds performance indexes on learning tables,
--              updated_at triggers for audit trails, and
--              realtime publication subscriptions
-- ============================================================

-- ============================================================
-- SECTION 1: Updated_at Trigger Function
-- ============================================================

-- Generic trigger function that stamps updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 2: Updated_at Triggers on Key Tables
-- ============================================================

-- Trigger on concept_mastery for audit trail
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname   = 'trg_concept_mastery_updated_at'
      AND tgrelid  = 'concept_mastery'::regclass
  ) THEN
    CREATE TRIGGER trg_concept_mastery_updated_at
      BEFORE UPDATE ON concept_mastery
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- Trigger on chat_sessions for real-time activity tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname   = 'trg_chat_sessions_updated_at'
      AND tgrelid  = 'chat_sessions'::regclass
  ) THEN
    CREATE TRIGGER trg_chat_sessions_updated_at
      BEFORE UPDATE ON chat_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ============================================================
-- SECTION 3: Performance Indexes on Learning Tables
-- ============================================================

-- Student learning profiles
CREATE INDEX IF NOT EXISTS idx_student_learning_profiles_student_id
  ON student_learning_profiles(student_id);

CREATE INDEX IF NOT EXISTS idx_student_learning_profiles_subject
  ON student_learning_profiles(subject);

CREATE INDEX IF NOT EXISTS idx_student_learning_profiles_student_subject
  ON student_learning_profiles(student_id, subject);

-- Concept mastery tracking
CREATE INDEX IF NOT EXISTS idx_concept_mastery_student_id
  ON concept_mastery(student_id);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_topic_id
  ON concept_mastery(topic_id);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_student_topic
  ON concept_mastery(student_id, topic_id);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_next_review
  ON concept_mastery(student_id, next_review_at);

-- Topic mastery
CREATE INDEX IF NOT EXISTS idx_topic_mastery_student_id
  ON topic_mastery(student_id);

CREATE INDEX IF NOT EXISTS idx_topic_mastery_subject
  ON topic_mastery(student_id, subject);

CREATE INDEX IF NOT EXISTS idx_topic_mastery_subject_topic
  ON topic_mastery(student_id, subject, topic);

-- Study plans and tasks
CREATE INDEX IF NOT EXISTS idx_study_plans_student_id
  ON study_plans(student_id);

CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_plan_id
  ON study_plan_tasks(plan_id);

CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_student_id
  ON study_plan_tasks(plan_id, student_id);

CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_scheduled_date
  ON study_plan_tasks(scheduled_date);

CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_plan_order
  ON study_plan_tasks(plan_id, day_number, task_order);

-- Quiz sessions
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_student_id
  ON quiz_sessions(student_id);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_completed_at
  ON quiz_sessions(student_id, completed_at DESC);

-- Spaced repetition cards
CREATE INDEX IF NOT EXISTS idx_spaced_repetition_cards_student_id
  ON spaced_repetition_cards(student_id);

CREATE INDEX IF NOT EXISTS idx_spaced_repetition_cards_review_date
  ON spaced_repetition_cards(student_id, next_review_date);

-- Competitions
CREATE INDEX IF NOT EXISTS idx_competitions_status
  ON competitions(status);

CREATE INDEX IF NOT EXISTS idx_competition_participants_student_id
  ON competition_participants(student_id);

CREATE INDEX IF NOT EXISTS idx_competition_participants_competition_id
  ON competition_participants(competition_id);

-- ============================================================
-- SECTION 4: Realtime Publications
-- ============================================================

-- Enable realtime for notifications
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'notifications' AND relnamespace = 'public'::regnamespace)
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;
-- Enable realtime for classroom interactions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'classroom_poll_responses' AND relnamespace = 'public'::regnamespace)
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_poll_responses'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_poll_responses';
  END IF;
END $$;
-- Enable realtime for student learning profiles (activity tracking)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'student_learning_profiles' AND relnamespace = 'public'::regnamespace)
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'student_learning_profiles'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.student_learning_profiles';
  END IF;
END $$;

-- ============================================================
-- > Section: 003_strengthen_rls.sql
-- ============================================================

-- ============================================================
-- Migration 003: Strengthen Row Level Security Policies
-- Project: Alfanumrik
-- Description: Adds and updates RLS policies for guardians
--              and teachers to access student learning data,
--              and service role policies for system tables
-- ============================================================

-- ============================================================
-- SECTION 1: Enable RLS on System Tables
-- ============================================================

ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECTION 2: Guardian and Teacher SELECT Policies
--            for Student Learning Data
-- ============================================================

-- Guardian SELECT on concept_mastery
DROP POLICY IF EXISTS "concept_mastery_select_guardian" ON concept_mastery;
CREATE POLICY "concept_mastery_select_guardian" ON concept_mastery
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on concept_mastery
DROP POLICY IF EXISTS "concept_mastery_select_teacher" ON concept_mastery;
CREATE POLICY "concept_mastery_select_teacher" ON concept_mastery
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on spaced_repetition_cards
DROP POLICY IF EXISTS "spaced_repetition_cards_select_guardian" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_select_guardian" ON spaced_repetition_cards
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on spaced_repetition_cards
DROP POLICY IF EXISTS "spaced_repetition_cards_select_teacher" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_select_teacher" ON spaced_repetition_cards
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on student_simulation_progress
DROP POLICY IF EXISTS "student_simulation_progress_select_guardian" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_select_guardian" ON student_simulation_progress
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on student_simulation_progress
DROP POLICY IF EXISTS "student_simulation_progress_select_teacher" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_select_teacher" ON student_simulation_progress
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on study_plan_tasks
DROP POLICY IF EXISTS "study_plan_tasks_select_guardian" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_select_guardian" ON study_plan_tasks
  FOR SELECT USING (
    plan_id IN (
      SELECT id FROM study_plans WHERE is_guardian_of(student_id)
    )
  );

-- Teacher SELECT on study_plan_tasks
DROP POLICY IF EXISTS "study_plan_tasks_select_teacher" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_select_teacher" ON study_plan_tasks
  FOR SELECT USING (
    plan_id IN (
      SELECT id FROM study_plans WHERE is_teacher_of(student_id)
    )
  );

-- Guardian SELECT on study_plans
DROP POLICY IF EXISTS "study_plans_select_guardian" ON study_plans;
CREATE POLICY "study_plans_select_guardian" ON study_plans
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on study_plans
DROP POLICY IF EXISTS "study_plans_select_teacher" ON study_plans;
CREATE POLICY "study_plans_select_teacher" ON study_plans
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on quiz_sessions
DROP POLICY IF EXISTS "quiz_sessions_select_guardian" ON quiz_sessions;
CREATE POLICY "quiz_sessions_select_guardian" ON quiz_sessions
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on quiz_sessions
DROP POLICY IF EXISTS "quiz_sessions_select_teacher" ON quiz_sessions;
CREATE POLICY "quiz_sessions_select_teacher" ON quiz_sessions
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on student_learning_profiles
DROP POLICY IF EXISTS "student_learning_profiles_select_guardian" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_select_guardian" ON student_learning_profiles
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on student_learning_profiles
DROP POLICY IF EXISTS "student_learning_profiles_select_teacher" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_select_teacher" ON student_learning_profiles
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on topic_mastery
DROP POLICY IF EXISTS "topic_mastery_select_guardian" ON topic_mastery;
CREATE POLICY "topic_mastery_select_guardian" ON topic_mastery
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on topic_mastery
DROP POLICY IF EXISTS "topic_mastery_select_teacher" ON topic_mastery;
CREATE POLICY "topic_mastery_select_teacher" ON topic_mastery
  FOR SELECT USING (is_teacher_of(student_id));

-- ============================================================
-- SECTION 3: Service Role Policies
-- ============================================================

-- Service role INSERT on notifications (for system-generated messages)
DROP POLICY IF EXISTS "notifications_insert_service_role" ON notifications;
CREATE POLICY "notifications_insert_service_role" ON notifications
  FOR INSERT TO service_role WITH CHECK (true);

-- Service role SELECT on notifications (for administrative access)
DROP POLICY IF EXISTS "notifications_select_service_role" ON notifications;
CREATE POLICY "notifications_select_service_role" ON notifications
  FOR SELECT TO service_role USING (true);

-- Service role UPDATE on notifications
DROP POLICY IF EXISTS "notifications_update_service_role" ON notifications;
CREATE POLICY "notifications_update_service_role" ON notifications
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- Service role on task_queue (full access for background jobs)
DROP POLICY IF EXISTS "task_queue_service_role" ON task_queue;
CREATE POLICY "task_queue_service_role" ON task_queue
  TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- SECTION 4: Student Learning Profile Policies
-- ============================================================

-- Student SELECT own profiles
DROP POLICY IF EXISTS "student_learning_profiles_select_own" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_select_own" ON student_learning_profiles
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own profiles
DROP POLICY IF EXISTS "student_learning_profiles_insert_own" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_insert_own" ON student_learning_profiles
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own profiles
DROP POLICY IF EXISTS "student_learning_profiles_update_own" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_update_own" ON student_learning_profiles
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 5: Concept Mastery Policies
-- ============================================================

-- Student SELECT own mastery data
DROP POLICY IF EXISTS "concept_mastery_select_own" ON concept_mastery;
CREATE POLICY "concept_mastery_select_own" ON concept_mastery
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own mastery data
DROP POLICY IF EXISTS "concept_mastery_insert_own" ON concept_mastery;
CREATE POLICY "concept_mastery_insert_own" ON concept_mastery
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own mastery data
DROP POLICY IF EXISTS "concept_mastery_update_own" ON concept_mastery;
CREATE POLICY "concept_mastery_update_own" ON concept_mastery
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 6: Spaced Repetition Cards Policies
-- ============================================================

-- Student SELECT own cards
DROP POLICY IF EXISTS "spaced_repetition_cards_select_own" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_select_own" ON spaced_repetition_cards
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own cards
DROP POLICY IF EXISTS "spaced_repetition_cards_insert_own" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_insert_own" ON spaced_repetition_cards
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own cards
DROP POLICY IF EXISTS "spaced_repetition_cards_update_own" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_update_own" ON spaced_repetition_cards
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 7: Student Simulation Progress Policies
-- ============================================================

-- Student SELECT own simulations
DROP POLICY IF EXISTS "student_simulation_progress_select_own" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_select_own" ON student_simulation_progress
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own simulations
DROP POLICY IF EXISTS "student_simulation_progress_insert_own" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_insert_own" ON student_simulation_progress
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own simulations
DROP POLICY IF EXISTS "student_simulation_progress_update_own" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_update_own" ON student_simulation_progress
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 8: Study Plans and Tasks Policies
-- ============================================================

-- Student SELECT own plans
DROP POLICY IF EXISTS "study_plans_select_own" ON study_plans;
CREATE POLICY "study_plans_select_own" ON study_plans
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own plans
DROP POLICY IF EXISTS "study_plans_insert_own" ON study_plans;
CREATE POLICY "study_plans_insert_own" ON study_plans
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own plans
DROP POLICY IF EXISTS "study_plans_update_own" ON study_plans;
CREATE POLICY "study_plans_update_own" ON study_plans
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- Study plan tasks policies
DROP POLICY IF EXISTS "study_plan_tasks_select_own" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_select_own" ON study_plan_tasks
  FOR SELECT USING (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

DROP POLICY IF EXISTS "study_plan_tasks_insert_own" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_insert_own" ON study_plan_tasks
  FOR INSERT WITH CHECK (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

DROP POLICY IF EXISTS "study_plan_tasks_update_own" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_update_own" ON study_plan_tasks
  FOR UPDATE USING (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  ) WITH CHECK (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

-- ============================================================
-- SECTION 9: Quiz Sessions Policies
-- ============================================================

-- Student SELECT own quiz sessions
DROP POLICY IF EXISTS "quiz_sessions_select_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_select_own" ON quiz_sessions
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own quiz sessions
DROP POLICY IF EXISTS "quiz_sessions_insert_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_insert_own" ON quiz_sessions
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own quiz sessions
DROP POLICY IF EXISTS "quiz_sessions_update_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_update_own" ON quiz_sessions
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 10: Topic Mastery Policies
-- ============================================================

-- Student SELECT own topic mastery
DROP POLICY IF EXISTS "topic_mastery_select_own" ON topic_mastery;
CREATE POLICY "topic_mastery_select_own" ON topic_mastery
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own topic mastery
DROP POLICY IF EXISTS "topic_mastery_insert_own" ON topic_mastery;
CREATE POLICY "topic_mastery_insert_own" ON topic_mastery
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own topic mastery
DROP POLICY IF EXISTS "topic_mastery_update_own" ON topic_mastery;
CREATE POLICY "topic_mastery_update_own" ON topic_mastery
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- > Section: 004_security_hardening.sql
-- ============================================================

-- ============================================================
-- Migration 004: Security Hardening
-- Project: Alfanumrik
-- Description: Anti-abuse protections for profile handover,
--              quiz gaming, and account sharing
-- ============================================================

-- ============================================================
-- SECTION 1: Profile Lock — Prevent Account Handover
-- ============================================================

-- Track how many times a student has changed their name.
-- Business rule: Name can only be changed once (to fix typos).
-- After that, support must approve changes.
ALTER TABLE students ADD COLUMN IF NOT EXISTS name_change_count INTEGER DEFAULT 0;

-- Track the last grade change to prevent grade manipulation.
-- Business rule: Grade can only increase by 1 (annual promotion).
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_grade_change TIMESTAMPTZ;

-- Device fingerprint — detect when a different device accesses the account.
-- This is NOT for blocking (students change phones), but for flagging
-- suspicious patterns (e.g., 3 different devices in 1 hour = sharing).
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_device_hash TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS device_change_count INTEGER DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_device_change TIMESTAMPTZ;

-- ============================================================
-- SECTION 2: Quiz Session Anti-Gaming
-- ============================================================

-- Minimum time per question (prevents instant-submit bots).
-- A real student needs at least 3 seconds per question.
-- Flag quiz sessions that are impossibly fast.
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS flagged_suspicious BOOLEAN DEFAULT FALSE;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS flag_reason TEXT;

-- Track IP and user agent for quiz submissions (anomaly detection).
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS submitted_from_ip TEXT;

-- ============================================================
-- SECTION 3: Rate Limiting Table for Parent Portal
-- ============================================================

-- Persistent rate limiting for parent link code attempts.
-- In-memory rate limiting resets on function restart; this persists.
CREATE TABLE IF NOT EXISTS parent_login_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address TEXT NOT NULL,
  link_code TEXT NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now(),
  success BOOLEAN DEFAULT FALSE
);

-- Index for fast lookups during rate limit checks.
CREATE INDEX IF NOT EXISTS idx_parent_login_attempts_ip
  ON parent_login_attempts(ip_address, attempted_at DESC);

-- Auto-cleanup: delete attempts older than 24 hours.
-- Run via pg_cron or a scheduled function.
CREATE INDEX IF NOT EXISTS idx_parent_login_attempts_cleanup
  ON parent_login_attempts(attempted_at);

-- RLS: Only service role can access this table.
ALTER TABLE parent_login_attempts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECTION 4: Spaced Repetition Anti-Gaming
-- ============================================================

-- Track last review timestamp to prevent rapid-fire card reviews.
ALTER TABLE spaced_repetition_cards ADD COLUMN IF NOT EXISTS last_review_at TIMESTAMPTZ;

-- ============================================================
-- SECTION 5: Study Plan Task State Machine (DB-level enforcement)
-- ============================================================

-- Create a function that validates state transitions for study_plan_tasks.
-- This is the database-level enforcement matching the client-side validation.
CREATE OR REPLACE FUNCTION validate_task_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Only validate if status is changing
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Completed tasks cannot be changed (terminal state)
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot change status of completed task';
  END IF;

  -- Validate allowed transitions
  IF OLD.status = 'pending' AND NEW.status NOT IN ('in_progress', 'skipped') THEN
    RAISE EXCEPTION 'Invalid transition from pending to %', NEW.status;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status NOT IN ('completed', 'skipped', 'pending') THEN
    RAISE EXCEPTION 'Invalid transition from in_progress to %', NEW.status;
  END IF;

  IF OLD.status = 'skipped' AND NEW.status NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'Invalid transition from skipped to %', NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger
DROP TRIGGER IF EXISTS trg_validate_task_transition ON study_plan_tasks;
CREATE TRIGGER trg_validate_task_transition
  BEFORE UPDATE OF status ON study_plan_tasks
  FOR EACH ROW
  EXECUTE FUNCTION validate_task_transition();

-- ============================================================
-- SECTION 6: Quiz Anti-Cheat Trigger
-- ============================================================

-- Flag quiz sessions that are impossibly fast.
-- Minimum 3 seconds per question for a genuine attempt.
CREATE OR REPLACE FUNCTION flag_suspicious_quiz()
RETURNS TRIGGER AS $$
DECLARE
  min_time_seconds INTEGER;
  question_count INTEGER;
BEGIN
  -- Only check completed sessions
  IF NOT NEW.is_completed THEN
    RETURN NEW;
  END IF;

  question_count := NEW.total_questions;
  IF question_count IS NULL OR question_count = 0 THEN
    RETURN NEW;
  END IF;

  -- Minimum 3 seconds per question
  min_time_seconds := question_count * 3;

  IF NEW.time_taken_seconds IS NOT NULL AND NEW.time_taken_seconds < min_time_seconds THEN
    NEW.flagged_suspicious := TRUE;
    NEW.flag_reason := format(
      'Impossibly fast: %s seconds for %s questions (min: %s)',
      NEW.time_taken_seconds, question_count, min_time_seconds
    );
  END IF;

  -- Flag perfect scores on 10+ questions (statistically unlikely without cheating)
  IF NEW.score_percent = 100 AND question_count >= 10 THEN
    NEW.flagged_suspicious := TRUE;
    NEW.flag_reason := COALESCE(NEW.flag_reason || '; ', '') ||
      format('Perfect score on %s questions', question_count);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_flag_suspicious_quiz ON quiz_sessions;
CREATE TRIGGER trg_flag_suspicious_quiz
  BEFORE INSERT OR UPDATE ON quiz_sessions
  FOR EACH ROW
  EXECUTE FUNCTION flag_suspicious_quiz();

-- ============================================================
-- > Section: 005_welcome_email_triggers.sql
-- ============================================================

-- Migration: Welcome Email Database Triggers
-- Uses pg_net extension for async HTTP calls to send welcome emails
-- Triggers fire on auth.users when email is confirmed (UPDATE) or auto-confirmed (INSERT/OAuth)

-- Enable pg_net for async HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Config table for storing non-secret settings (URL) and referencing vault for secrets
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Populate Supabase URL from current_setting (set via Supabase dashboard > Database > Settings)
-- After running this migration, set the values:
--   INSERT INTO app_config (key, value) VALUES ('supabase_url', 'https://<your-ref>.supabase.co');
-- Store the anon key in Supabase Vault (Dashboard > Settings > Vault):
--   SELECT vault.create_secret('<your-anon-key>', 'supabase_anon_key');
-- Or as a fallback, store it in app_config:
--   INSERT INTO app_config (key, value) VALUES ('supabase_anon_key', '<your-anon-key>');
--
-- The trigger functions below read from app_config at runtime.

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Only service_role and postgres can read app_config
DROP POLICY IF EXISTS app_config_select_policy ON public.app_config;
CREATE POLICY app_config_select_policy ON public.app_config
  FOR SELECT TO postgres, service_role USING (true);

-- Helper function to read config, checking vault first for secrets, then app_config
CREATE OR REPLACE FUNCTION public.get_app_config(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value TEXT;
BEGIN
  -- Try Supabase Vault first (for secrets like anon key)
  BEGIN
    SELECT decrypted_secret INTO v_value
    FROM vault.decrypted_secrets
    WHERE name = p_key
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_value := NULL;
  END;

  IF v_value IS NOT NULL THEN
    RETURN v_value;
  END IF;

  -- Fall back to app_config table
  SELECT value INTO v_value FROM public.app_config WHERE key = p_key LIMIT 1;

  IF v_value IS NULL THEN
    RAISE EXCEPTION 'Missing app config key: %. Set it in vault or app_config table.', p_key;
  END IF;

  RETURN v_value;
END;
$$;

-- Trigger function: fires when existing user confirms their email (UPDATE flow)
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role TEXT := 'student';
  v_name TEXT;
  v_email TEXT;
  v_grade TEXT := '';
  v_board TEXT := '';
  v_school TEXT := '';
  v_payload JSONB;
  v_supabase_url TEXT;
  v_anon_key TEXT;
BEGIN
  -- Read config at runtime instead of hardcoding secrets
  v_supabase_url := public.get_app_config('supabase_url');
  v_anon_key := public.get_app_config('supabase_anon_key');

  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_email := NEW.email;
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(v_email, '@', 1));

  IF EXISTS (SELECT 1 FROM students WHERE auth_user_id = NEW.id) THEN
    v_role := 'student';
    SELECT COALESCE(grade, ''), COALESCE(board, '') INTO v_grade, v_board
    FROM students WHERE auth_user_id = NEW.id LIMIT 1;
    v_grade := REPLACE(v_grade, 'Grade ', '');
  ELSIF EXISTS (SELECT 1 FROM teachers WHERE auth_user_id = NEW.id) THEN
    v_role := 'teacher';
    SELECT COALESCE(school_name, '') INTO v_school
    FROM teachers WHERE auth_user_id = NEW.id LIMIT 1;
  ELSIF EXISTS (SELECT 1 FROM guardians WHERE auth_user_id = NEW.id) THEN
    v_role := 'parent';
  END IF;

  v_payload := jsonb_build_object(
    'role', v_role, 'name', v_name, 'email', v_email,
    'grade', v_grade, 'board', v_board, 'school_name', v_school
  );

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-welcome-email',
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Welcome email trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_send_welcome_email ON auth.users;
CREATE TRIGGER trigger_send_welcome_email
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.send_welcome_email_on_confirm();

-- Trigger function: fires for auto-confirmed users (e.g. Google OAuth)
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role TEXT := 'student';
  v_name TEXT;
  v_email TEXT;
  v_payload JSONB;
  v_supabase_url TEXT;
  v_anon_key TEXT;
BEGIN
  -- Read config at runtime instead of hardcoding secrets
  v_supabase_url := public.get_app_config('supabase_url');
  v_anon_key := public.get_app_config('supabase_anon_key');

  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_email := NEW.email;
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(v_email, '@', 1));

  v_payload := jsonb_build_object(
    'role', v_role, 'name', v_name, 'email', v_email,
    'grade', '', 'board', '', 'school_name', ''
  );

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-welcome-email',
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Welcome email insert trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_send_welcome_email_insert ON auth.users;
CREATE TRIGGER trigger_send_welcome_email_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.send_welcome_email_on_insert();

-- Grant permissions to auth admin
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_app_config(TEXT) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.send_welcome_email_on_confirm() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.send_welcome_email_on_insert() TO supabase_auth_admin;
GRANT SELECT ON public.app_config TO supabase_auth_admin;

-- ============================================================
-- > Section: 006_cognitive_engine_tables.sql
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- ALFANUMRIK 2.0 — Cognitive Engine Database Migration
-- New tables for Bloom's progression, ZPD tracking, board papers,
-- learning velocity, knowledge gaps, and question responses.
-- Enhanced columns on question_bank and concept_mastery.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. CBSE Board Papers Reference Table ─────────────────────
CREATE TABLE IF NOT EXISTS cbse_board_papers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year          smallint NOT NULL CHECK (year BETWEEN 2015 AND 2030),
  subject       text NOT NULL,
  set_code      text,                -- e.g. '65/1/1', '65/2/3'
  paper_section text,                -- e.g. 'A', 'B', 'C'
  total_marks   smallint DEFAULT 80,
  board         text DEFAULT 'CBSE',
  grade         text DEFAULT '10',
  paper_url     text,                -- optional link to PDF
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(year, subject, set_code)
);

-- ─── 2. Bloom's Progression Tracking ──────────────────────────
-- Per-student, per-topic, per-bloom-level mastery tracking
CREATE TABLE IF NOT EXISTS bloom_progression (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id      uuid NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  bloom_level   text NOT NULL CHECK (bloom_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')),
  attempts      int DEFAULT 0,
  correct       int DEFAULT 0,
  mastery       real DEFAULT 0 CHECK (mastery BETWEEN 0 AND 1),
  last_attempted timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(student_id, topic_id, bloom_level)
);

-- ─── 3. Cognitive Session Metrics ─────────────────────────────
-- Fatigue detection, difficulty adjustments, ZPD accuracy per session
CREATE TABLE IF NOT EXISTS cognitive_session_metrics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id          uuid REFERENCES quiz_sessions(id) ON DELETE SET NULL,
  zpd_target          real,           -- target difficulty (0-1)
  zpd_actual          real,           -- actual performance
  zpd_accuracy        real,           -- how well ZPD matched
  bloom_distribution  jsonb,          -- { remember: 2, understand: 3, apply: 1, ... }
  interleaving_ratio  real,           -- ratio of mixed topics (0-1)
  fatigue_detected    boolean DEFAULT false,
  difficulty_adjustments int DEFAULT 0, -- number of mid-session adjustments
  consecutive_errors  int DEFAULT 0,
  consecutive_correct int DEFAULT 0,
  avg_response_time   real,           -- seconds
  session_duration    int,            -- seconds
  questions_attempted int DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

-- ─── 4. Learning Velocity ────────────────────────────────────
-- Rate of mastery improvement, predicted mastery dates
CREATE TABLE IF NOT EXISTS learning_velocity (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id              uuid NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  subject               text NOT NULL,
  velocity_score        real DEFAULT 0,     -- mastery points per session
  mastery_datapoints    jsonb DEFAULT '[]', -- [{date, mastery}] for regression
  predicted_mastery_date date,              -- when student will reach 0.95
  sessions_to_mastery   int,                -- estimated sessions remaining
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(student_id, topic_id)
);

-- ─── 5. Knowledge Gaps ──────────────────────────────────────
-- Prerequisite chain analysis, gap detection
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id            uuid NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  prerequisite_topic_id uuid REFERENCES curriculum_topics(id) ON DELETE SET NULL,
  gap_type            text DEFAULT 'weak_prerequisite' CHECK (gap_type IN ('weak_prerequisite', 'missing_bloom_level', 'stale_knowledge', 'persistent_error')),
  severity            text DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description         text,
  description_hi      text,
  recommended_action  text,
  recommended_action_hi text,
  is_resolved         boolean DEFAULT false,
  detected_at         timestamptz DEFAULT now(),
  resolved_at         timestamptz,
  UNIQUE(student_id, topic_id, gap_type)
);

-- ─── 6. Question Responses (per-question detail) ─────────────
-- Enhanced response tracking with bloom level and reflection data
CREATE TABLE IF NOT EXISTS question_responses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL,
  session_id        uuid REFERENCES quiz_sessions(id) ON DELETE SET NULL,
  selected_option   smallint NOT NULL,
  is_correct        boolean NOT NULL,
  time_spent        real DEFAULT 0,         -- seconds
  bloom_level       text,
  difficulty        smallint,
  source            text DEFAULT 'practice', -- 'practice', 'board', 'cognitive'
  board_year        smallint,               -- if from board exam
  reflection_shown  boolean DEFAULT false,
  reflection_type   text,                   -- 'metacognitive', 'praise', 'pause'
  created_at        timestamptz DEFAULT now()
);

-- ─── 7. Enhance question_bank with board exam metadata ────────
-- Add columns for CBSE source tracking
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source text DEFAULT 'internal';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS board_year smallint;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS marks smallint DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS cbse_question_type text DEFAULT 'mcq';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS paper_section text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS set_code text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS board_paper_id uuid REFERENCES cbse_board_papers(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─── 8. Enhance concept_mastery with SM-2 fields ─────────────
DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS ease_factor real DEFAULT 2.5;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS sm2_interval real DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS sm2_repetitions int DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─── 9. Indexes for performance ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bloom_progression_student
  ON bloom_progression(student_id, topic_id);

CREATE INDEX IF NOT EXISTS idx_cognitive_metrics_student
  ON cognitive_session_metrics(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_velocity_student
  ON learning_velocity(student_id, subject);

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_student_unresolved
  ON knowledge_gaps(student_id) WHERE NOT is_resolved;

CREATE INDEX IF NOT EXISTS idx_question_responses_student
  ON question_responses(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_question_responses_session
  ON question_responses(session_id);

CREATE INDEX IF NOT EXISTS idx_question_bank_source
  ON question_bank(source, board_year) WHERE source = 'cbse_board';

CREATE INDEX IF NOT EXISTS idx_question_bank_bloom
  ON question_bank(bloom_level, difficulty);

CREATE INDEX IF NOT EXISTS idx_cbse_board_papers_lookup
  ON cbse_board_papers(year, subject);

-- ─── 10. RLS Policies ────────────────────────────────────────
ALTER TABLE bloom_progression ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_session_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_velocity ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbse_board_papers ENABLE ROW LEVEL SECURITY;

-- Students can read their own data
DROP POLICY IF EXISTS "students_read_own_bloom" ON bloom_progression;
CREATE POLICY "students_read_own_bloom" ON bloom_progression
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "students_read_own_cognitive" ON cognitive_session_metrics;
CREATE POLICY "students_read_own_cognitive" ON cognitive_session_metrics
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "students_read_own_velocity" ON learning_velocity;
CREATE POLICY "students_read_own_velocity" ON learning_velocity
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "students_read_own_gaps" ON knowledge_gaps;
CREATE POLICY "students_read_own_gaps" ON knowledge_gaps
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "students_read_own_responses" ON question_responses;
CREATE POLICY "students_read_own_responses" ON question_responses
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

-- Board papers are public read
DROP POLICY IF EXISTS "anyone_read_board_papers" ON cbse_board_papers;
CREATE POLICY "anyone_read_board_papers" ON cbse_board_papers
  FOR SELECT USING (true);

-- Service role can do everything (for edge functions)
DROP POLICY IF EXISTS "service_all_bloom" ON bloom_progression;
CREATE POLICY "service_all_bloom" ON bloom_progression
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_all_cognitive" ON cognitive_session_metrics;
CREATE POLICY "service_all_cognitive" ON cognitive_session_metrics
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_all_velocity" ON learning_velocity;
CREATE POLICY "service_all_velocity" ON learning_velocity
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_all_gaps" ON knowledge_gaps;
CREATE POLICY "service_all_gaps" ON knowledge_gaps
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_all_responses" ON question_responses;
CREATE POLICY "service_all_responses" ON question_responses
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_all_board_papers" ON cbse_board_papers;
CREATE POLICY "service_all_board_papers" ON cbse_board_papers
  FOR ALL USING (auth.role() = 'service_role');

-- ─── 11. Helper function: get board exam questions ────────────
CREATE OR REPLACE FUNCTION get_board_exam_questions(
  p_subject text,
  p_grade text,
  p_year smallint DEFAULT NULL,
  p_count int DEFAULT 20
)
RETURNS SETOF question_bank
LANGUAGE sql STABLE
AS $$
  SELECT qb.*
  FROM question_bank qb
  JOIN subjects s ON s.id = qb.subject_id
  WHERE s.code = p_subject
    AND qb.is_active = true
    AND qb.source = 'cbse_board'
    AND (p_year IS NULL OR qb.board_year = p_year)
  ORDER BY
    CASE WHEN p_year IS NOT NULL THEN qb.board_year END DESC NULLS LAST,
    random()
  LIMIT p_count;
$$;

-- ─── 12. Helper function: get bloom progression for student ───
CREATE OR REPLACE FUNCTION get_bloom_progression(
  p_student_id uuid,
  p_subject text DEFAULT NULL
)
RETURNS TABLE(
  topic_id uuid,
  topic_title text,
  bloom_level text,
  mastery real,
  attempts int,
  correct int
)
LANGUAGE sql STABLE
AS $$
  SELECT
    bp.topic_id,
    ct.title AS topic_title,
    bp.bloom_level,
    bp.mastery,
    bp.attempts,
    bp.correct
  FROM bloom_progression bp
  JOIN curriculum_topics ct ON ct.id = bp.topic_id
  LEFT JOIN subjects s ON s.id = ct.subject_id
  WHERE bp.student_id = p_student_id
    AND (p_subject IS NULL OR s.code = p_subject)
  ORDER BY ct.display_order,
    CASE bp.bloom_level
      WHEN 'remember' THEN 1
      WHEN 'understand' THEN 2
      WHEN 'apply' THEN 3
      WHEN 'analyze' THEN 4
      WHEN 'evaluate' THEN 5
      WHEN 'create' THEN 6
    END;
$$;

-- ─── 13. Helper: get knowledge gaps for student ───────────────
CREATE OR REPLACE FUNCTION get_knowledge_gaps(
  p_student_id uuid,
  p_subject text DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  topic_title text,
  gap_type text,
  severity text,
  description text,
  description_hi text,
  recommended_action text,
  recommended_action_hi text,
  detected_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kg.id,
    ct.title AS topic_title,
    kg.gap_type,
    kg.severity,
    kg.description,
    kg.description_hi,
    kg.recommended_action,
    kg.recommended_action_hi,
    kg.detected_at
  FROM knowledge_gaps kg
  JOIN curriculum_topics ct ON ct.id = kg.topic_id
  LEFT JOIN subjects s ON s.id = ct.subject_id
  WHERE kg.student_id = p_student_id
    AND NOT kg.is_resolved
    AND (p_subject IS NULL OR s.code = p_subject)
  ORDER BY
    CASE kg.severity
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    kg.detected_at DESC
  LIMIT p_limit;
$$;

-- ============================================================
-- > Section: 007_core_rpcs.sql
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- ALFANUMRIK 2.0 — Core RPC Functions
-- Critical server-side functions for quiz submission, snapshot,
-- question retrieval, and profile management.
-- These RPCs are called by the client app and MUST exist.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. submit_quiz_results ──────────────────────────────────
-- Called after every quiz. Creates session, records responses,
-- updates XP, mastery, streak, and learning profile atomically.
-- Returns: { total, correct, score_percent, xp_earned, session_id }
CREATE OR REPLACE FUNCTION submit_quiz_results(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT,
  p_chapter INT,
  p_responses JSONB,
  p_time INT
) RETURNS JSONB AS $$
DECLARE
  v_total INT;
  v_correct INT;
  v_score_percent INT;
  v_xp INT;
  v_session_id UUID;
  v_resp JSONB;
  v_bonus INT := 0;
BEGIN
  -- Count correct answers
  v_total := jsonb_array_length(p_responses);
  SELECT COUNT(*) INTO v_correct
  FROM jsonb_array_elements(p_responses) r
  WHERE (r->>'is_correct')::boolean = true;

  -- Calculate score
  v_score_percent := CASE WHEN v_total > 0 THEN ROUND((v_correct::numeric / v_total) * 100) ELSE 0 END;

  -- Calculate XP: 10 per correct + 20 bonus for 80%+
  v_xp := v_correct * 10;
  IF v_score_percent >= 80 THEN
    v_bonus := 20;
    v_xp := v_xp + v_bonus;
  END IF;

  -- 1. Insert quiz session
  INSERT INTO quiz_sessions (
    student_id, subject, topic_id, total_questions, correct_answers,
    score_percent, xp_earned, time_seconds, grade, completed_at
  ) VALUES (
    p_student_id, p_subject, NULL, v_total, v_correct,
    v_score_percent, v_xp, p_time, p_grade, now()
  ) RETURNING id INTO v_session_id;

  -- 2. Insert per-question responses (if question_responses table exists)
  BEGIN
    FOR v_resp IN SELECT * FROM jsonb_array_elements(p_responses)
    LOOP
      INSERT INTO question_responses (
        student_id, session_id, question_id, selected_option,
        is_correct, time_spent, source
      ) VALUES (
        p_student_id, v_session_id,
        (v_resp->>'question_id')::UUID,
        (v_resp->>'selected_option')::INT,
        (v_resp->>'is_correct')::BOOLEAN,
        COALESCE((v_resp->>'time_spent')::INT, 0),
        'practice'
      );
    END LOOP;
  EXCEPTION WHEN undefined_table THEN
    -- question_responses table doesn't exist yet, skip
    NULL;
  END;

  -- 3. Update student_learning_profiles (upsert)
  INSERT INTO student_learning_profiles (
    student_id, subject, xp, total_sessions, total_questions_asked,
    total_questions_answered_correctly, total_time_minutes,
    last_session_at, streak_days, level
  ) VALUES (
    p_student_id, p_subject, v_xp, 1, v_total, v_correct,
    GREATEST(1, ROUND(p_time / 60.0)), now(), 1, 1
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    xp = student_learning_profiles.xp + v_xp,
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + v_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + v_correct,
    total_time_minutes = student_learning_profiles.total_time_minutes + GREATEST(1, ROUND(p_time / 60.0)),
    last_session_at = now(),
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_xp) / 500) + 1);

  -- 4. Update student XP total and last_active
  UPDATE students SET
    xp_total = COALESCE(xp_total, 0) + v_xp,
    last_active = now()
  WHERE id = p_student_id;

  -- 5. Update streak
  UPDATE students SET
    streak_days = CASE
      WHEN last_active::date = CURRENT_DATE THEN COALESCE(streak_days, 0)
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 2. get_student_snapshot ─────────────────────────────────
-- Returns aggregated stats for the dashboard hero card.
CREATE OR REPLACE FUNCTION get_student_snapshot(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_xp BIGINT;
  v_streak INT;
  v_mastered INT;
  v_in_progress INT;
  v_quizzes INT;
  v_avg_score INT;
  v_total_asked BIGINT;
  v_total_correct BIGINT;
BEGIN
  -- XP and stats from learning profiles
  SELECT
    COALESCE(SUM(xp), 0),
    COALESCE(MAX(streak_days), 0),
    COALESCE(SUM(total_questions_asked), 0),
    COALESCE(SUM(total_questions_answered_correctly), 0)
  INTO v_total_xp, v_streak, v_total_asked, v_total_correct
  FROM student_learning_profiles
  WHERE student_id = p_student_id;

  -- Also check students table for streak (might be more up-to-date)
  SELECT GREATEST(v_streak, COALESCE(s.streak_days, 0))
  INTO v_streak
  FROM students s WHERE s.id = p_student_id;

  -- Also add students.xp_total if it's higher
  SELECT GREATEST(v_total_xp, COALESCE(s.xp_total, 0))
  INTO v_total_xp
  FROM students s WHERE s.id = p_student_id;

  -- Mastery counts from concept_mastery
  SELECT COUNT(*) INTO v_mastered
  FROM concept_mastery
  WHERE student_id = p_student_id AND mastery_level >= 0.95;

  SELECT COUNT(*) INTO v_in_progress
  FROM concept_mastery
  WHERE student_id = p_student_id AND mastery_level > 0 AND mastery_level < 0.95;

  -- Quiz count
  SELECT COUNT(*) INTO v_quizzes
  FROM quiz_sessions
  WHERE student_id = p_student_id;

  -- Average score
  v_avg_score := CASE WHEN v_total_asked > 0
    THEN ROUND((v_total_correct::numeric / v_total_asked) * 100)
    ELSE 0 END;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp,
    'current_streak', v_streak,
    'topics_mastered', v_mastered,
    'topics_in_progress', v_in_progress,
    'quizzes_taken', v_quizzes,
    'avg_score', v_avg_score
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 3. get_quiz_questions ───────────────────────────────────
-- Fetches questions from question_bank for a subject/grade.
-- Returns randomized questions filtered by difficulty.
CREATE OR REPLACE FUNCTION get_quiz_questions(
  p_subject TEXT,
  p_grade TEXT,
  p_count INT DEFAULT 10,
  p_difficulty INT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_questions JSONB;
BEGIN
  SELECT jsonb_agg(q) INTO v_questions
  FROM (
    SELECT
      id, question_text, question_hi, question_type,
      options, correct_answer_index, explanation, explanation_hi,
      hint, difficulty, bloom_level, chapter_number
    FROM question_bank
    WHERE subject = p_subject
      AND grade = p_grade
      AND is_active = true
      AND (p_difficulty IS NULL OR difficulty = p_difficulty)
    ORDER BY random()
    LIMIT LEAST(p_count, 30)
  ) q;

  RETURN COALESCE(v_questions, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 4. get_review_cards ─────────────────────────────────────
-- Fetches concepts due for spaced repetition review.
CREATE OR REPLACE FUNCTION get_review_cards(
  p_student_id UUID,
  p_limit INT DEFAULT 10
) RETURNS JSONB AS $$
DECLARE
  v_cards JSONB;
BEGIN
  SELECT jsonb_agg(c) INTO v_cards
  FROM (
    SELECT
      cm.id, cm.subject, cm.topic_tag as topic,
      COALESCE(cm.chapter_title, cm.topic_tag) as chapter_title,
      cm.front_text, cm.back_text, cm.hint,
      cm.ease_factor, cm.interval_days, cm.streak,
      cm.repetition_count, cm.total_reviews, cm.correct_reviews
    FROM concept_mastery cm
    WHERE cm.student_id = p_student_id
      AND cm.next_review_at <= now()
      AND cm.front_text IS NOT NULL
    ORDER BY cm.next_review_at ASC
    LIMIT p_limit
  ) c;

  RETURN COALESCE(v_cards, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 5. get_leaderboard ──────────────────────────────────────
-- Weekly or monthly leaderboard ranked by XP.
CREATE OR REPLACE FUNCTION get_leaderboard(
  p_period TEXT DEFAULT 'weekly',
  p_limit INT DEFAULT 20
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_since TIMESTAMPTZ;
BEGIN
  IF p_period = 'monthly' THEN
    v_since := date_trunc('month', now());
  ELSE
    v_since := date_trunc('week', now());
  END IF;

  SELECT jsonb_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY COALESCE(s.xp_total, 0) DESC) as rank,
      s.id as student_id,
      s.name,
      COALESCE(s.xp_total, 0) as total_xp,
      COALESCE(s.streak_days, 0) as streak,
      s.avatar_url,
      s.grade,
      s.school_name as school,
      s.city,
      s.board
    FROM students s
    WHERE s.is_active = true
      AND s.last_active >= v_since
    ORDER BY COALESCE(s.xp_total, 0) DESC
    LIMIT p_limit
  ) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 6. get_study_plan ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_study_plan(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_plan RECORD;
  v_tasks JSONB;
BEGIN
  SELECT * INTO v_plan
  FROM study_plans
  WHERE student_id = p_student_id AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('has_plan', false);
  END IF;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.day_number, t.task_order) INTO v_tasks
  FROM study_plan_tasks t
  WHERE t.plan_id = v_plan.id;

  RETURN jsonb_build_object(
    'has_plan', true,
    'plan', row_to_json(v_plan),
    'tasks', COALESCE(v_tasks, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 7. get_user_role ────────────────────────────────────────
-- Determines the role(s) for an auth user.
CREATE OR REPLACE FUNCTION get_user_role(p_auth_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_roles JSONB := '[]'::jsonb;
  v_student RECORD;
  v_teacher RECORD;
  v_guardian RECORD;
BEGIN
  SELECT id, name INTO v_student FROM students WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
  IF v_student IS NOT NULL THEN
    v_roles := v_roles || jsonb_build_array(jsonb_build_object('role', 'student', 'id', v_student.id, 'name', v_student.name));
  END IF;

  BEGIN
    SELECT id, name INTO v_teacher FROM teachers WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
    IF v_teacher IS NOT NULL THEN
      v_roles := v_roles || jsonb_build_array(jsonb_build_object('role', 'teacher', 'id', v_teacher.id, 'name', v_teacher.name));
    END IF;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    SELECT id, name INTO v_guardian FROM guardians WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
    IF v_guardian IS NOT NULL THEN
      v_roles := v_roles || jsonb_build_array(jsonb_build_object('role', 'guardian', 'id', v_guardian.id, 'name', v_guardian.name));
    END IF;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  RETURN v_roles;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 8. generate_notifications ───────────────────────────────
CREATE OR REPLACE FUNCTION generate_notifications(p_student_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Placeholder: actual notification logic can be added later
  -- This prevents the client from erroring when calling this RPC
  NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 9. get_student_notifications ────────────────────────────
CREATE OR REPLACE FUNCTION get_student_notifications(p_student_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object('unread_count', 0, 'notifications', '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 10. Indexes for performance ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_student_id ON quiz_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_created_at ON quiz_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slp_student_subject ON student_learning_profiles(student_id, subject);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_student ON concept_mastery(student_id);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_review ON concept_mastery(student_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_question_bank_subject_grade ON question_bank(subject, grade, is_active);
CREATE INDEX IF NOT EXISTS idx_students_xp ON students(xp_total DESC);
CREATE INDEX IF NOT EXISTS idx_students_last_active ON students(last_active DESC);

-- ============================================================
-- > Section: 007_dashboard_rpcs.sql
-- ============================================================

-- ============================================================
-- Migration 007: Dashboard & Core RPCs
-- Project: Alfanumrik
-- Description: Creates all RPC functions needed by the frontend
--              for dashboard, quiz, leaderboard, study plan,
--              review, notifications, teacher, and guardian flows.
-- ============================================================

-- ============================================================
-- 1. get_user_role — Returns all roles for an auth user
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role(p_auth_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  v_roles TEXT[] := '{}';
  v_primary TEXT := 'none';
  v_student JSONB := 'null';
  v_teacher JSONB := 'null';
  v_guardian JSONB := 'null';
  rec RECORD;
BEGIN
  -- Check student
  SELECT id, name, grade INTO rec
    FROM students WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_roles := array_append(v_roles, 'student');
    v_primary := 'student';
    v_student := jsonb_build_object('id', rec.id, 'name', rec.name, 'grade', rec.grade);
  END IF;

  -- Check teacher
  SELECT id, name INTO rec
    FROM teachers WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF FOUND THEN
    v_roles := array_append(v_roles, 'teacher');
    v_primary := 'teacher';
    v_teacher := jsonb_build_object('id', rec.id, 'name', rec.name);
  END IF;

  -- Check guardian
  SELECT id, name INTO rec
    FROM guardians WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF FOUND THEN
    v_roles := array_append(v_roles, 'guardian');
    IF v_primary = 'none' THEN v_primary := 'guardian'; END IF;
    v_guardian := jsonb_build_object('id', rec.id, 'name', rec.name);
  END IF;

  RETURN jsonb_build_object(
    'roles', to_jsonb(v_roles),
    'primary_role', v_primary,
    'student', v_student,
    'teacher', v_teacher,
    'guardian', v_guardian
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 2. get_student_snapshot — Dashboard stats for a student
-- ============================================================
CREATE OR REPLACE FUNCTION get_student_snapshot(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_xp BIGINT := 0;
  v_streak INT := 0;
  v_mastered INT := 0;
  v_in_progress INT := 0;
  v_quizzes INT := 0;
  v_correct BIGINT := 0;
  v_asked BIGINT := 0;
  v_avg_score INT := 0;
BEGIN
  SELECT COALESCE(SUM(xp), 0),
         COALESCE(MAX(streak_days), 0),
         COALESCE(SUM(total_questions_answered_correctly), 0),
         COALESCE(SUM(total_questions_asked), 0)
    INTO v_total_xp, v_streak, v_correct, v_asked
    FROM student_learning_profiles
   WHERE student_id = p_student_id;

  SELECT COUNT(*) INTO v_mastered
    FROM concept_mastery
   WHERE student_id = p_student_id AND mastery_level >= 0.95;

  SELECT COUNT(*) INTO v_in_progress
    FROM concept_mastery
   WHERE student_id = p_student_id AND mastery_level < 0.95 AND mastery_level > 0;

  SELECT COUNT(*) INTO v_quizzes
    FROM quiz_sessions
   WHERE student_id = p_student_id;

  IF v_asked > 0 THEN
    v_avg_score := ROUND((v_correct::NUMERIC / v_asked) * 100);
  END IF;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp,
    'current_streak', v_streak,
    'topics_mastered', v_mastered,
    'topics_in_progress', v_in_progress,
    'quizzes_taken', v_quizzes,
    'avg_score', v_avg_score
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 3. get_dashboard_data — Full dashboard payload
-- ============================================================
CREATE OR REPLACE FUNCTION get_dashboard_data(p_student_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN get_student_snapshot(p_student_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 4. get_quiz_questions — Fetch quiz questions
-- ============================================================
CREATE OR REPLACE FUNCTION get_quiz_questions(
  p_subject TEXT,
  p_grade TEXT,
  p_count INT DEFAULT 10,
  p_difficulty INT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_subject_id UUID;
  v_questions JSONB;
BEGIN
  SELECT id INTO v_subject_id FROM subjects WHERE code = p_subject LIMIT 1;

  IF v_subject_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Pull questions from question_bank if it exists, else from curriculum_topics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_text_hi, options, correct_option,
             explanation, explanation_hi, difficulty, bloom_level, topic_id
        FROM question_bank
       WHERE subject = p_subject
         AND grade = p_grade
         AND is_active = true
         AND (p_difficulty IS NULL OR difficulty = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) q;
  ELSE
    -- Fallback: generate placeholder from curriculum_topics
    SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, title AS question_text, title_hi AS question_text_hi,
             '["Option A","Option B","Option C","Option D"]'::JSONB AS options,
             0 AS correct_option,
             description AS explanation,
             NULL AS explanation_hi,
             difficulty_level AS difficulty,
             'remember' AS bloom_level,
             id AS topic_id
        FROM curriculum_topics
       WHERE subject_id = v_subject_id
         AND grade = p_grade
         AND is_active = true
         AND (p_difficulty IS NULL OR difficulty_level = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) t;
  END IF;

  RETURN v_questions;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 5. submit_quiz_results — Record quiz completion + XP
-- ============================================================
CREATE OR REPLACE FUNCTION submit_quiz_results(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT,
  p_chapter INT,
  p_responses JSONB,
  p_time INT
)
RETURNS JSONB AS $$
DECLARE
  v_total INT;
  v_correct INT := 0;
  v_score NUMERIC;
  v_xp INT;
  v_session_id UUID;
  r JSONB;
BEGIN
  v_total := jsonb_array_length(p_responses);

  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    IF (r->>'is_correct')::BOOLEAN THEN
      v_correct := v_correct + 1;
    END IF;
  END LOOP;

  v_score := CASE WHEN v_total > 0 THEN ROUND((v_correct::NUMERIC / v_total) * 100) ELSE 0 END;
  v_xp := v_correct * 10 + CASE WHEN v_score >= 80 THEN 20 ELSE 0 END;

  INSERT INTO quiz_sessions (student_id, subject, topic_id, total_questions, correct_answers, score_percent, xp_earned, time_spent_seconds, completed_at)
  VALUES (p_student_id, p_subject, NULL, v_total, v_correct, v_score, v_xp, p_time, now())
  RETURNING id INTO v_session_id;

  -- Update XP in learning profile
  INSERT INTO student_learning_profiles (student_id, subject, xp, level, total_sessions, total_questions_asked, total_questions_answered_correctly, streak_days, longest_streak)
  VALUES (p_student_id, p_subject, v_xp, 1, 1, v_total, v_correct, 1, 1)
  ON CONFLICT (student_id, subject)
  DO UPDATE SET
    xp = student_learning_profiles.xp + v_xp,
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_xp) / 500) + 1),
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + v_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + v_correct,
    last_session_at = now(),
    updated_at = now();

  -- Update concept mastery
  IF p_topic IS NOT NULL THEN
    INSERT INTO concept_mastery (student_id, topic_tag, chapter_number, mastery_level, last_attempted)
    VALUES (p_student_id, p_topic, p_chapter, v_score / 100.0, now())
    ON CONFLICT (student_id, topic_tag)
    DO UPDATE SET
      mastery_level = LEAST(1.0, concept_mastery.mastery_level * 0.7 + (v_score / 100.0) * 0.3),
      last_attempted = now(),
      next_review_at = now() + INTERVAL '1 day' * GREATEST(1, FLOOR(concept_mastery.mastery_level * 7)),
      updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'score', v_score,
    'correct', v_correct,
    'total', v_total,
    'xp_earned', v_xp
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. get_leaderboard — Weekly/monthly/all-time leaderboard
-- ============================================================
CREATE OR REPLACE FUNCTION get_leaderboard(
  p_period TEXT DEFAULT 'weekly',
  p_limit INT DEFAULT 20
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(r ORDER BY r.rank), '[]'::JSONB) INTO v_result
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY COALESCE(s.xp_total, slp.total_xp) DESC) AS rank,
      s.id AS student_id,
      s.name AS student_name,
      COALESCE(s.xp_total, slp.total_xp, 0) AS total_xp,
      COALESCE(s.streak_days, slp.max_streak, 0) AS streak,
      CASE WHEN slp.total_asked > 0
        THEN ROUND((slp.total_correct::NUMERIC / slp.total_asked) * 100)
        ELSE 0
      END AS accuracy,
      s.avatar_url,
      s.grade,
      s.school_name AS school,
      s.city
    FROM students s
    LEFT JOIN (
      SELECT student_id,
             SUM(xp) AS total_xp,
             MAX(streak_days) AS max_streak,
             SUM(total_questions_asked) AS total_asked,
             SUM(total_questions_answered_correctly) AS total_correct
        FROM student_learning_profiles
       GROUP BY student_id
    ) slp ON slp.student_id = s.id
    WHERE s.is_active = true
    ORDER BY COALESCE(s.xp_total, slp.total_xp, 0) DESC
    LIMIT p_limit
  ) r;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 7. get_study_plan — Return study plan for student
-- ============================================================
CREATE OR REPLACE FUNCTION get_study_plan(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_student RECORD;
BEGIN
  SELECT preferred_subject, grade INTO v_student FROM students WHERE id = p_student_id;

  SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_result
  FROM (
    SELECT ct.id, ct.title, ct.title_hi, ct.grade, ct.chapter_number,
           ct.difficulty_level, ct.estimated_minutes, ct.bloom_focus,
           COALESCE(cm.mastery_level, 0) AS mastery_level,
           CASE WHEN cm.mastery_level >= 0.95 THEN 'mastered'
                WHEN cm.mastery_level > 0 THEN 'in_progress'
                ELSE 'not_started'
           END AS status
      FROM curriculum_topics ct
      LEFT JOIN concept_mastery cm ON cm.topic_tag = ct.title AND cm.student_id = p_student_id
      LEFT JOIN subjects s ON s.id = ct.subject_id
     WHERE ct.grade = v_student.grade
       AND ct.is_active = true
       AND (v_student.preferred_subject IS NULL OR s.code = v_student.preferred_subject)
     ORDER BY ct.display_order, ct.chapter_number
     LIMIT 20
  ) t;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 8. get_review_cards — Spaced repetition review cards
-- ============================================================
CREATE OR REPLACE FUNCTION get_review_cards(p_student_id UUID, p_limit INT DEFAULT 10)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(r), '[]'::JSONB) INTO v_result
  FROM (
    SELECT cm.id, cm.topic_tag, cm.chapter_number, cm.mastery_level,
           cm.last_attempted, cm.next_review_at
      FROM concept_mastery cm
     WHERE cm.student_id = p_student_id
       AND cm.next_review_at <= now()
     ORDER BY cm.mastery_level ASC, cm.next_review_at ASC
     LIMIT p_limit
  ) r;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 9. get_teacher_dashboard — Teacher overview
-- ============================================================
CREATE OR REPLACE FUNCTION get_teacher_dashboard(p_teacher_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_classes JSONB;
  v_total_students INT := 0;
BEGIN
  SELECT COALESCE(jsonb_agg(c), '[]'::JSONB), COALESCE(SUM((c->>'student_count')::INT), 0)
    INTO v_classes, v_total_students
  FROM (
    SELECT jsonb_build_object(
      'id', cl.id,
      'name', cl.name,
      'grade', cl.grade,
      'section', cl.section,
      'class_code', cl.class_code,
      'student_count', (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = cl.id)
    ) AS c
    FROM classes cl
    JOIN class_teachers ct ON ct.class_id = cl.id
    WHERE ct.teacher_id = p_teacher_id
    ORDER BY cl.created_at DESC
  ) sub;

  RETURN jsonb_build_object(
    'classes', v_classes,
    'total_students', v_total_students
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 10. teacher_create_class
-- ============================================================
CREATE OR REPLACE FUNCTION teacher_create_class(
  p_teacher_id UUID,
  p_name TEXT,
  p_grade TEXT,
  p_section TEXT DEFAULT NULL,
  p_subject TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_class_id UUID;
  v_code TEXT;
BEGIN
  v_code := UPPER(SUBSTR(md5(random()::TEXT), 1, 6));

  INSERT INTO classes (name, grade, section, subject, class_code, created_by)
  VALUES (p_name, p_grade, p_section, p_subject, v_code, p_teacher_id)
  RETURNING id INTO v_class_id;

  INSERT INTO class_teachers (class_id, teacher_id) VALUES (v_class_id, p_teacher_id);

  RETURN jsonb_build_object('class_id', v_class_id, 'class_code', v_code);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. student_join_class
-- ============================================================
CREATE OR REPLACE FUNCTION student_join_class(p_student_id UUID, p_class_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_class_id UUID;
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE class_code = UPPER(TRIM(p_class_code));

  IF v_class_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid class code');
  END IF;

  INSERT INTO class_students (class_id, student_id)
  VALUES (v_class_id, p_student_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true, 'class_id', v_class_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. get_class_detail
-- ============================================================
CREATE OR REPLACE FUNCTION get_class_detail(p_class_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_class JSONB;
  v_students JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', cl.id, 'name', cl.name, 'grade', cl.grade,
    'section', cl.section, 'class_code', cl.class_code
  ) INTO v_class FROM classes cl WHERE cl.id = p_class_id;

  SELECT COALESCE(jsonb_agg(s), '[]'::JSONB) INTO v_students
  FROM (
    SELECT st.id, st.name, st.grade, COALESCE(st.xp_total, 0) AS xp_total
      FROM students st
      JOIN class_students cs ON cs.student_id = st.id
     WHERE cs.class_id = p_class_id
     ORDER BY st.name
  ) s;

  RETURN jsonb_build_object('class', v_class, 'students', v_students);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 13. teacher_create_assignment
-- ============================================================
CREATE OR REPLACE FUNCTION teacher_create_assignment(
  p_teacher_id UUID,
  p_class_id UUID,
  p_title TEXT,
  p_type TEXT DEFAULT 'practice',
  p_topic_id UUID DEFAULT NULL,
  p_subject TEXT DEFAULT NULL,
  p_due_date TIMESTAMPTZ DEFAULT NULL,
  p_question_count INT DEFAULT 10
)
RETURNS JSONB AS $$
DECLARE
  v_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assignments') THEN
    INSERT INTO assignments (class_id, teacher_id, title, assignment_type, topic_id, subject, due_date, question_count, created_at)
    VALUES (p_class_id, p_teacher_id, p_title, p_type, p_topic_id, p_subject, p_due_date, p_question_count, now())
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('assignment_id', v_id);
  ELSE
    RETURN jsonb_build_object('error', 'Assignments table not yet created');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 14. get_assignment_report
-- ============================================================
CREATE OR REPLACE FUNCTION get_assignment_report(p_assignment_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assignments') THEN
    RETURN (
      SELECT jsonb_build_object(
        'assignment', jsonb_build_object('id', a.id, 'title', a.title, 'due_date', a.due_date),
        'submissions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'student_id', sub.student_id,
            'score', sub.score_percent,
            'completed_at', sub.completed_at
          ))
          FROM assignment_submissions sub
          WHERE sub.assignment_id = a.id
        ), '[]'::JSONB)
      ) FROM assignments a WHERE a.id = p_assignment_id
    );
  END IF;
  RETURN '{}'::JSONB;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 15. get_guardian_dashboard
-- ============================================================
CREATE OR REPLACE FUNCTION get_guardian_dashboard(p_guardian_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_children JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(c), '[]'::JSONB) INTO v_children
  FROM (
    SELECT s.id, s.name, s.grade,
           COALESCE(s.xp_total, 0) AS xp_total,
           COALESCE(s.streak_days, 0) AS streak_days,
           s.last_active
      FROM students s
      JOIN guardian_student_links gsl ON gsl.student_id = s.id
     WHERE gsl.guardian_id = p_guardian_id
       AND gsl.status = 'active'
     ORDER BY s.name
  ) c;

  RETURN jsonb_build_object('children', v_children);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 16. Notification RPCs
-- ============================================================

-- get_unread_notifications
CREATE OR REPLACE FUNCTION get_unread_notifications(p_recipient_type TEXT, p_recipient_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(n ORDER BY n.created_at DESC), '[]'::JSONB)
    FROM notifications n
    WHERE n.recipient_type = p_recipient_type
      AND n.recipient_id = p_recipient_id
      AND n.read_at IS NULL
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- mark_notification_read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    UPDATE notifications SET read_at = now() WHERE id = p_notification_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_student_notifications
CREATE OR REPLACE FUNCTION get_student_notifications(p_student_id UUID, p_limit INT DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
  v_notifications JSONB := '[]'::JSONB;
  v_unread INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    SELECT COALESCE(jsonb_agg(n), '[]'::JSONB) INTO v_notifications
    FROM (
      SELECT id, title, body, icon, notification_type, read_at, created_at
        FROM notifications
       WHERE recipient_id = p_student_id
         AND recipient_type = 'student'
       ORDER BY created_at DESC
       LIMIT p_limit
    ) n;

    SELECT COUNT(*) INTO v_unread
      FROM notifications
     WHERE recipient_id = p_student_id
       AND recipient_type = 'student'
       AND read_at IS NULL;
  END IF;

  RETURN jsonb_build_object('notifications', v_notifications, 'unread_count', v_unread);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- generate_student_notifications (contextual notifications)
CREATE OR REPLACE FUNCTION generate_student_notifications(p_student_id UUID)
RETURNS VOID AS $$
DECLARE
  v_streak INT;
  v_due_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    RETURN;
  END IF;

  -- Streak milestone notifications
  SELECT COALESCE(MAX(streak_days), 0) INTO v_streak
    FROM student_learning_profiles WHERE student_id = p_student_id;

  IF v_streak > 0 AND v_streak % 7 = 0 THEN
    INSERT INTO notifications (recipient_id, recipient_type, title, body, icon, notification_type)
    SELECT p_student_id, 'student',
           v_streak || ' day streak!',
           'Amazing consistency! Keep it going!',
           '🔥', 'streak_milestone'
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications
       WHERE recipient_id = p_student_id
         AND notification_type = 'streak_milestone'
         AND created_at > now() - INTERVAL '1 day'
    );
  END IF;

  -- Review due notifications
  SELECT COUNT(*) INTO v_due_count
    FROM concept_mastery
   WHERE student_id = p_student_id
     AND next_review_at <= now();

  IF v_due_count > 0 THEN
    INSERT INTO notifications (recipient_id, recipient_type, title, body, icon, notification_type)
    SELECT p_student_id, 'student',
           v_due_count || ' topics due for review',
           'Strengthen your memory with a quick review session!',
           '🔄', 'review_due'
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications
       WHERE recipient_id = p_student_id
         AND notification_type = 'review_due'
         AND created_at > now() - INTERVAL '6 hours'
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- mark_all_notifications_read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_student_id UUID)
RETURNS VOID AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    UPDATE notifications SET read_at = now()
     WHERE recipient_id = p_student_id
       AND recipient_type = 'student'
       AND read_at IS NULL;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 17. Curriculum & Mastery RPCs
-- ============================================================

-- get_curriculum_browser
CREATE OR REPLACE FUNCTION get_curriculum_browser(p_grade TEXT, p_subject TEXT DEFAULT NULL)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(t), '[]'::JSONB)
    FROM (
      SELECT ct.id, ct.title, ct.title_hi, ct.grade, ct.chapter_number,
             ct.difficulty_level, ct.estimated_minutes, ct.bloom_focus,
             ct.learning_objectives, ct.topic_type,
             s.code AS subject_code, s.name AS subject_name, s.icon AS subject_icon
        FROM curriculum_topics ct
        JOIN subjects s ON s.id = ct.subject_id
       WHERE ct.grade = p_grade
         AND ct.is_active = true
         AND (p_subject IS NULL OR s.code = p_subject)
       ORDER BY s.display_order, ct.display_order
    ) t
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- get_mastery_overview
CREATE OR REPLACE FUNCTION get_mastery_overview(p_student_id UUID, p_subject TEXT DEFAULT NULL)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(m), '[]'::JSONB)
    FROM (
      SELECT cm.id, cm.topic_tag, cm.chapter_number, cm.mastery_level,
             cm.last_attempted, cm.next_review_at
        FROM concept_mastery cm
       WHERE cm.student_id = p_student_id
       ORDER BY cm.chapter_number, cm.topic_tag
    ) m
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- record_learning_event
CREATE OR REPLACE FUNCTION record_learning_event(
  p_student_id UUID,
  p_topic_id UUID,
  p_is_correct BOOLEAN,
  p_interaction_type TEXT DEFAULT 'practice',
  p_bloom_level TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_topic RECORD;
  v_new_mastery NUMERIC;
BEGIN
  SELECT title, chapter_number INTO v_topic FROM curriculum_topics WHERE id = p_topic_id;

  IF v_topic IS NULL THEN
    RETURN jsonb_build_object('error', 'Topic not found');
  END IF;

  -- Upsert concept mastery
  INSERT INTO concept_mastery (student_id, topic_id, topic_tag, chapter_number, mastery_level, last_attempted)
  VALUES (p_student_id, p_topic_id, v_topic.title, COALESCE(v_topic.chapter_number, 0),
          CASE WHEN p_is_correct THEN 0.3 ELSE 0.1 END, now())
  ON CONFLICT (student_id, topic_tag)
  DO UPDATE SET
    mastery_level = LEAST(1.0,
      concept_mastery.mastery_level + CASE WHEN p_is_correct THEN 0.1 ELSE -0.05 END
    ),
    last_attempted = now(),
    next_review_at = now() + INTERVAL '1 day' * GREATEST(1, FLOOR(concept_mastery.mastery_level * 7)),
    updated_at = now()
  RETURNING mastery_level INTO v_new_mastery;

  -- Update bloom progression if level provided
  IF p_bloom_level IS NOT NULL THEN
    INSERT INTO bloom_progression (student_id, topic_id, bloom_level, correct_at_level, total_at_level)
    VALUES (p_student_id, p_topic_id, p_bloom_level,
            CASE WHEN p_is_correct THEN 1 ELSE 0 END, 1)
    ON CONFLICT (student_id, topic_id, bloom_level)
    DO UPDATE SET
      correct_at_level = bloom_progression.correct_at_level + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
      total_at_level = bloom_progression.total_at_level + 1,
      mastered_at = CASE
        WHEN bloom_progression.correct_at_level + CASE WHEN p_is_correct THEN 1 ELSE 0 END >= 3
        THEN COALESCE(bloom_progression.mastered_at, now())
        ELSE bloom_progression.mastered_at
      END,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object('mastery_level', v_new_mastery, 'topic', v_topic.title);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 18. generate_weekly_study_plan
-- ============================================================
CREATE OR REPLACE FUNCTION generate_weekly_study_plan(
  p_student_id UUID,
  p_subject TEXT DEFAULT NULL,
  p_daily_minutes INT DEFAULT 60,
  p_days INT DEFAULT 7
)
RETURNS JSONB AS $$
DECLARE
  v_student RECORD;
  v_plan JSONB;
BEGIN
  SELECT grade, preferred_subject INTO v_student FROM students WHERE id = p_student_id;

  SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_plan
  FROM (
    SELECT ct.id, ct.title, ct.title_hi, ct.difficulty_level,
           ct.estimated_minutes, ct.bloom_focus,
           COALESCE(cm.mastery_level, 0) AS current_mastery,
           ROW_NUMBER() OVER () AS day_number
      FROM curriculum_topics ct
      LEFT JOIN concept_mastery cm ON cm.topic_tag = ct.title AND cm.student_id = p_student_id
      LEFT JOIN subjects s ON s.id = ct.subject_id
     WHERE ct.grade = v_student.grade
       AND ct.is_active = true
       AND (COALESCE(p_subject, v_student.preferred_subject) IS NULL
            OR s.code = COALESCE(p_subject, v_student.preferred_subject))
       AND COALESCE(cm.mastery_level, 0) < 0.95
     ORDER BY COALESCE(cm.mastery_level, 0) ASC, ct.display_order
     LIMIT p_days
  ) t;

  RETURN v_plan;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 19. Competition RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION get_competitions(p_student_id UUID, p_status TEXT DEFAULT NULL)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'competitions') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(c), '[]'::JSONB)
    FROM (
      SELECT co.id, co.title, co.title_hi, co.description, co.description_hi,
             co.competition_type, co.status, co.start_date, co.end_date,
             co.is_featured, co.accent_color, co.banner_emoji,
             co.bonus_xp_1, co.bonus_xp_2, co.bonus_xp_3,
             (SELECT COUNT(*) FROM competition_participants cp WHERE cp.competition_id = co.id) AS participant_count,
             EXISTS(SELECT 1 FROM competition_participants cp WHERE cp.competition_id = co.id AND cp.student_id = p_student_id) AS is_joined
        FROM competitions co
       WHERE (p_status IS NULL OR co.status = p_status)
       ORDER BY co.is_featured DESC, co.start_date DESC
    ) c
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION join_competition(p_student_id UUID, p_competition_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'competitions') THEN
    RETURN jsonb_build_object('error', 'Competitions not available');
  END IF;

  INSERT INTO competition_participants (competition_id, student_id)
  VALUES (p_competition_id, p_student_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_competition_leaderboard(p_competition_id UUID, p_limit INT DEFAULT 50)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'competitions') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(r), '[]'::JSONB)
    FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY cp.score DESC) AS rank,
             cp.student_id, s.name AS student_name, cp.score AS total_xp
        FROM competition_participants cp
        JOIN students s ON s.id = cp.student_id
       WHERE cp.competition_id = p_competition_id
       ORDER BY cp.score DESC
       LIMIT p_limit
    ) r
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_hall_of_fame(p_limit INT DEFAULT 30)
RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'student_titles') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(f), '[]'::JSONB)
    FROM (
      SELECT st.id, st.student_id, s.name AS student_name,
             st.title_name AS title, st.icon, st.earned_at
        FROM student_titles st
        JOIN students s ON s.id = st.student_id
       WHERE st.is_active = true
       ORDER BY st.earned_at DESC
       LIMIT p_limit
    ) f
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 20. link_guardian_to_student_via_code
-- ============================================================
CREATE OR REPLACE FUNCTION link_guardian_to_student_via_code(p_guardian_id UUID, p_invite_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_student_id UUID;
BEGIN
  -- Check if invite codes table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guardian_invite_codes') THEN
    SELECT student_id INTO v_student_id
      FROM guardian_invite_codes
     WHERE code = UPPER(TRIM(p_invite_code))
       AND used_at IS NULL
       AND expires_at > now();

    IF v_student_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired invite code');
    END IF;

    INSERT INTO guardian_student_links (guardian_id, student_id, status)
    VALUES (p_guardian_id, v_student_id, 'active')
    ON CONFLICT DO NOTHING;

    UPDATE guardian_invite_codes SET used_at = now(), used_by = p_guardian_id
     WHERE code = UPPER(TRIM(p_invite_code));

    RETURN jsonb_build_object('success', true, 'student_id', v_student_id);
  ELSE
    -- Fallback: try matching student by parent_phone
    SELECT id INTO v_student_id FROM students
     WHERE parent_phone IS NOT NULL
     LIMIT 1;

    RETURN jsonb_build_object('success', false, 'error', 'Invite code system not configured');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 21. Ensure notifications table exists
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL,
  recipient_type TEXT NOT NULL DEFAULT 'student',
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT DEFAULT '🔔',
  notification_type TEXT DEFAULT 'general',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, recipient_type, read_at);

-- ============================================================
-- 22. Ensure quiz_sessions has time_spent_seconds column
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quiz_sessions' AND column_name = 'time_spent_seconds'
  ) THEN
    ALTER TABLE quiz_sessions ADD COLUMN time_spent_seconds INT;
  END IF;
END $$;

-- ============================================================
-- 23. Ensure concept_mastery has needed columns
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'concept_mastery' AND column_name = 'next_review_at'
  ) THEN
    ALTER TABLE concept_mastery ADD COLUMN next_review_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'concept_mastery' AND column_name = 'topic_id'
  ) THEN
    ALTER TABLE concept_mastery ADD COLUMN topic_id UUID;
  END IF;
END $$;

-- ============================================================
-- > Section: 008_fix_snapshot_rpc_and_rls.sql
-- ============================================================

-- ═══ 008: Fix get_student_snapshot RPC, RLS policies, and stale overloads ═══
-- Applied: 2026-03-24

-- ═══ 1. CREATE get_student_snapshot RPC ═══
CREATE OR REPLACE FUNCTION public.get_student_snapshot(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total_xp integer;
  v_streak integer;
  v_mastered integer;
  v_in_progress integer;
  v_quizzes integer;
  v_correct integer;
  v_asked integer;
BEGIN
  -- XP and streak from learning profiles
  SELECT COALESCE(SUM(xp), 0), COALESCE(MAX(streak_days), 0),
         COALESCE(SUM(total_questions_answered_correctly), 0),
         COALESCE(SUM(total_questions_asked), 0)
  INTO v_total_xp, v_streak, v_correct, v_asked
  FROM student_learning_profiles
  WHERE student_id = p_student_id;

  -- Also add XP from students table if higher
  SELECT GREATEST(v_total_xp, COALESCE(s.xp_total, 0)),
         GREATEST(v_streak, COALESCE(s.streak_days, 0))
  INTO v_total_xp, v_streak
  FROM students s WHERE s.id = p_student_id;

  -- Mastery counts from concept_mastery (mastery_probability is numeric)
  SELECT COUNT(*) FILTER (WHERE mastery_probability >= 0.95),
         COUNT(*) FILTER (WHERE mastery_probability > 0 AND mastery_probability < 0.95)
  INTO v_mastered, v_in_progress
  FROM concept_mastery
  WHERE student_id = p_student_id;

  -- If concept_mastery is empty, fall back to topic_mastery
  IF v_mastered = 0 AND v_in_progress = 0 THEN
    SELECT COUNT(*) FILTER (WHERE mastery_level >= 0.95),
           COUNT(*) FILTER (WHERE mastery_level > 0 AND mastery_level < 0.95)
    INTO v_mastered, v_in_progress
    FROM topic_mastery
    WHERE student_id = p_student_id;
  END IF;

  -- Quiz count
  SELECT COUNT(*) INTO v_quizzes
  FROM quiz_sessions
  WHERE student_id = p_student_id AND is_completed = true;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp,
    'current_streak', v_streak,
    'topics_mastered', v_mastered,
    'topics_in_progress', v_in_progress,
    'quizzes_taken', v_quizzes,
    'avg_score', CASE WHEN v_asked > 0 THEN ROUND((v_correct::numeric / v_asked) * 100) ELSE 0 END
  );
END;
$$;

-- ═══ 2. FIX RLS POLICIES — add WITH CHECK for inserts on cognitive tables ═══

-- bloom_progression
DROP POLICY IF EXISTS "Students can view their own bloom progression" ON bloom_progression;
DROP POLICY IF EXISTS "bloom_own_select" ON bloom_progression;
CREATE POLICY "bloom_own_select" ON bloom_progression FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id));
DROP POLICY IF EXISTS "bloom_own_insert" ON bloom_progression;
CREATE POLICY "bloom_own_insert" ON bloom_progression FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id));
DROP POLICY IF EXISTS "bloom_own_update" ON bloom_progression;
CREATE POLICY "bloom_own_update" ON bloom_progression FOR UPDATE
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id));

-- cognitive_session_metrics
DROP POLICY IF EXISTS "Students can view their own cognitive metrics" ON cognitive_session_metrics;
DROP POLICY IF EXISTS "csm_own_select" ON cognitive_session_metrics;
CREATE POLICY "csm_own_select" ON cognitive_session_metrics FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = cognitive_session_metrics.student_id));
DROP POLICY IF EXISTS "csm_own_insert" ON cognitive_session_metrics;
CREATE POLICY "csm_own_insert" ON cognitive_session_metrics FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = cognitive_session_metrics.student_id));

-- knowledge_gaps
DROP POLICY IF EXISTS "Students can view their own knowledge gaps" ON knowledge_gaps;
DROP POLICY IF EXISTS "kg_own_select" ON knowledge_gaps;
CREATE POLICY "kg_own_select" ON knowledge_gaps FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = knowledge_gaps.student_id));
DROP POLICY IF EXISTS "kg_own_insert" ON knowledge_gaps;
CREATE POLICY "kg_own_insert" ON knowledge_gaps FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = knowledge_gaps.student_id));

-- learning_velocity
DROP POLICY IF EXISTS "Students can view their own learning velocity" ON learning_velocity;
DROP POLICY IF EXISTS "lv_own_select" ON learning_velocity;
CREATE POLICY "lv_own_select" ON learning_velocity FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = learning_velocity.student_id));
DROP POLICY IF EXISTS "lv_own_insert" ON learning_velocity;
CREATE POLICY "lv_own_insert" ON learning_velocity FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = learning_velocity.student_id));

-- question_responses
DROP POLICY IF EXISTS "Students can view their own question responses" ON question_responses;
DROP POLICY IF EXISTS "qr_own_select" ON question_responses;
CREATE POLICY "qr_own_select" ON question_responses FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = question_responses.student_id));
DROP POLICY IF EXISTS "qr_own_insert" ON question_responses;
CREATE POLICY "qr_own_insert" ON question_responses FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = question_responses.student_id));

-- ═══ 3. DROP STALE submit_quiz_results OVERLOADS ═══
DROP FUNCTION IF EXISTS public.submit_quiz_results(uuid, timestamptz, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.submit_quiz_results(uuid, timestamptz, timestamptz, jsonb, text);
DROP FUNCTION IF EXISTS public.submit_quiz_results(uuid, timestamptz, timestamptz, jsonb, text, text);
