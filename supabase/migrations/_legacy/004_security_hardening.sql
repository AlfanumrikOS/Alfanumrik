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
