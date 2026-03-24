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
ALTER PUBLICATION supabase_realtime ADD TABLE IF EXISTS notifications;

-- Enable realtime for classroom interactions
ALTER PUBLICATION supabase_realtime ADD TABLE IF EXISTS classroom_poll_responses;

-- Enable realtime for student learning profiles (activity tracking)
ALTER PUBLICATION supabase_realtime ADD TABLE IF EXISTS student_learning_profiles;
