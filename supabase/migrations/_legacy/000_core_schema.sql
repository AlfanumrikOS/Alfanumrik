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
