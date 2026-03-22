-- ============================================================
-- Migration 002: Learning Tables
-- Alfanumrik — AI-powered CBSE learning platform
-- ============================================================

-- ============================================================
-- SECTION 1: Learning & Progress
-- ============================================================

-- Per-subject XP, level, streak, and session stats for each student
CREATE TABLE IF NOT EXISTS student_learning_profiles (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                      UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  subject                         TEXT NOT NULL,
  xp                              INT DEFAULT 0,
  level                           INT DEFAULT 1,
  streak_days                     INT DEFAULT 0,
  total_sessions                  INT DEFAULT 0,
  total_questions_asked           INT DEFAULT 0,
  -- Canonical correct-answer counter (aliased as total_questions_answered_correctly in queries)
  total_questions_correct         INT DEFAULT 0,
  total_time_minutes              INT DEFAULT 0,
  last_activity_at                TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, subject)
);

-- Per-concept mastery score with spaced-repetition next-review scheduling
CREATE TABLE IF NOT EXISTS concept_mastery (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  concept_id      TEXT NOT NULL,
  mastery_level   FLOAT DEFAULT 0.0,
  next_review_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, concept_id)
);

-- Coarser topic-level mastery (subject + topic text label)
CREATE TABLE IF NOT EXISTS topic_mastery (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  subject       TEXT NOT NULL,
  topic         TEXT NOT NULL,
  mastery_level FLOAT DEFAULT 0.0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, subject, topic)
);

-- Records of completed quiz sessions with per-question JSONB responses
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  score_percent  FLOAT,
  xp_earned      INT DEFAULT 0,
  difficulty     TEXT,
  question_count INT,
  responses      JSONB,
  completed_at   TIMESTAMPTZ DEFAULT now()
);

-- SM-2 spaced-repetition flashcards; extended fields match review/page.tsx writes
CREATE TABLE IF NOT EXISTS spaced_repetition_cards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  subject          TEXT,
  -- Front / back text used by the flip-card UI
  question         TEXT NOT NULL,   -- maps to front_text in RPC results
  answer           TEXT NOT NULL,   -- maps to back_text in RPC results
  -- Metadata shown in the card header
  topic            TEXT,
  chapter_title    TEXT,
  hint             TEXT,
  -- SM-2 algorithm state
  ease_factor      FLOAT DEFAULT 2.5,
  interval_days    INT DEFAULT 1,
  repetitions      INT DEFAULT 0,   -- total scheduled repetitions
  -- Additional tracking written by rateCard() in review/page.tsx
  streak           INT DEFAULT 0,            -- consecutive correct recalls
  repetition_count INT DEFAULT 0,            -- times actually reviewed
  total_reviews    INT DEFAULT 0,
  correct_reviews  INT DEFAULT 0,
  last_quality     INT,                      -- last SM-2 quality score (0–5)
  -- Scheduling dates
  next_review_date DATE DEFAULT CURRENT_DATE,
  last_reviewed_at TIMESTAMPTZ,
  last_review_date DATE,
  updated_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Reusable question bank referenced by quiz RPC and assignments
CREATE TABLE IF NOT EXISTS question_bank (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id     UUID REFERENCES subjects,
  grade          INT NOT NULL,
  topic          TEXT,
  question_text  TEXT NOT NULL,
  options        JSONB,
  correct_answer TEXT NOT NULL,
  difficulty     TEXT DEFAULT 'medium',
  bloom_level    TEXT,
  explanation    TEXT,
  is_active      BOOLEAN DEFAULT true
);

-- Tracks whether a student completed an interactive simulation
CREATE TABLE IF NOT EXISTS student_simulation_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  -- FK to interactive_simulations; soft reference in case table is created later
  simulation_id UUID REFERENCES interactive_simulations,
  completed     BOOLEAN DEFAULT false,
  score         INT,
  completed_at  TIMESTAMPTZ,
  UNIQUE (student_id, simulation_id)
);

-- ============================================================
-- SECTION 2: AI & Chat
-- ============================================================

-- Persistent Foxy AI chat sessions; messages stored as ordered JSONB array
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  subject    TEXT,
  mode       TEXT DEFAULT 'tutor',
  messages   JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Student-submitted reports on individual AI messages (safety / quality)
CREATE TABLE IF NOT EXISTS ai_response_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES chat_sessions,
  student_id    UUID REFERENCES students,
  message_index INT,
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SECTION 3: Study Plans
-- ============================================================

-- AI-generated multi-day study plans; richer metadata matches study-plan/page.tsx
CREATE TABLE IF NOT EXISTS study_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  -- Human-readable plan metadata set by generate_weekly_study_plan RPC
  title            TEXT,
  description      TEXT,
  plan_type        TEXT DEFAULT 'weekly',
  ai_reasoning     TEXT,
  -- Schedule window
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  daily_minutes    INT DEFAULT 30,
  -- Progress counters kept in sync by markTask() client-side and RPC
  total_tasks      INT DEFAULT 0,
  completed_tasks  INT DEFAULT 0,
  progress_percent FLOAT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Individual tasks within a plan; extra fields used by study-plan/page.tsx Task interface
CREATE TABLE IF NOT EXISTS study_plan_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID NOT NULL REFERENCES study_plans ON DELETE CASCADE,
  day_number      INT NOT NULL,
  -- Calendar date for the task (used to detect "today" in the UI)
  scheduled_date  DATE,
  task_order      INT DEFAULT 0,
  task_type       TEXT NOT NULL,  -- learn | quiz | review | practice | revision | notes | foxy_chat | challenge
  title           TEXT NOT NULL,
  description     TEXT,
  -- Curriculum linkage
  subject         TEXT,
  chapter_number  INT,
  chapter_title   TEXT,
  topic           TEXT,
  -- Effort / reward
  duration_minutes  INT DEFAULT 15,
  question_count    INT,
  difficulty        INT DEFAULT 1,
  xp_reward         INT DEFAULT 10,
  -- Outcome tracking written by markTask()
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  xp_earned       INT DEFAULT 0,
  score_percent   FLOAT,
  completed_at    TIMESTAMPTZ
);

-- ============================================================
-- SECTION 4: Gamification
-- ============================================================

-- Achievement definitions (condition evaluated server-side)
CREATE TABLE IF NOT EXISTS achievements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  description      TEXT,
  category         TEXT,
  icon             TEXT,
  condition_type   TEXT NOT NULL,
  condition_value  INT DEFAULT 0,
  xp_reward        INT DEFAULT 0
);

-- Junction table: which students have earned which achievements
CREATE TABLE IF NOT EXISTS student_achievements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements ON DELETE CASCADE,
  earned_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, achievement_id)
);

-- Cosmetic titles a student can earn and equip (is_active = currently displayed)
CREATE TABLE IF NOT EXISTS student_titles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  title      TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT false,
  earned_at  TIMESTAMPTZ DEFAULT now()
);

-- Olympiad and competition definitions
CREATE TABLE IF NOT EXISTS competitions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  type       TEXT DEFAULT 'olympiad',
  status     TEXT DEFAULT 'upcoming'
             CHECK (status IN ('upcoming', 'live', 'completed')),
  start_date TIMESTAMPTZ,
  end_date   TIMESTAMPTZ,
  rules      JSONB DEFAULT '{}'
);

-- Student participation and scores for a competition
CREATE TABLE IF NOT EXISTS competition_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES students ON DELETE CASCADE,
  score          INT DEFAULT 0,
  rank           INT,
  submitted_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (competition_id, student_id)
);

-- ============================================================
-- SECTION 5: System Tables
-- ============================================================

-- In-app notifications for students, teachers, and guardians
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type TEXT NOT NULL DEFAULT 'student',
  recipient_id   UUID NOT NULL,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  data           JSONB DEFAULT '{}',
  is_read        BOOLEAN DEFAULT false,
  action_url     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Feature flag registry for gradual rollouts and grade-targeted features
CREATE TABLE IF NOT EXISTS feature_flags (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_name           TEXT UNIQUE NOT NULL,
  is_enabled          BOOLEAN DEFAULT false,
  rollout_percentage  INT DEFAULT 100,
  target_grades       INT[] DEFAULT '{}',
  description         TEXT
);

-- Customer support / bug report tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students,
  subject    TEXT,
  message    TEXT NOT NULL,
  status     TEXT DEFAULT 'open'
             CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Teacher-created homework and assessment assignments
CREATE TABLE IF NOT EXISTS assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers ON DELETE CASCADE,
  class_id    UUID REFERENCES classes ON DELETE SET NULL,
  title       TEXT NOT NULL,
  type        TEXT DEFAULT 'homework',
  description TEXT,
  due_date    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

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
