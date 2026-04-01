-- Migration: 20260401180000_demo_account_system.sql
-- Purpose: Add demo account system for showcasing Alfanumrik to prospects.
-- Adds is_demo_user flag to role tables, demo_accounts metadata table,
-- demo_seed_data table for reset snapshots, and a reset RPC.

-- =============================================================================
-- 1. Add is_demo_user column to role tables
-- =============================================================================

ALTER TABLE students ADD COLUMN IF NOT EXISTS is_demo_user BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_demo_user BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS is_demo_user BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- 2. Create demo_accounts table
-- =============================================================================

CREATE TABLE IF NOT EXISTS demo_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'parent')),
  persona TEXT NOT NULL DEFAULT 'average' CHECK (persona IN ('weak', 'average', 'high_performer')),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(auth_user_id)
);

ALTER TABLE demo_accounts ENABLE ROW LEVEL SECURITY;

-- RLS: Admin-only via service role. No direct user access needed.
-- Service role bypasses RLS, so no permissive policies required.
-- Add a deny-all default so anon/authenticated cannot access.
-- (RLS enabled with no policies = deny all by default.)

-- =============================================================================
-- 3. Create demo_seed_data table
-- =============================================================================

CREATE TABLE IF NOT EXISTS demo_seed_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_account_id UUID NOT NULL REFERENCES demo_accounts(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL,
  seed_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE demo_seed_data ENABLE ROW LEVEL SECURITY;

-- RLS: Admin-only via service role. Same deny-all default as demo_accounts.

-- =============================================================================
-- 4. Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_demo_accounts_role ON demo_accounts(role);
CREATE INDEX IF NOT EXISTS idx_demo_accounts_is_active ON demo_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_demo_seed_data_account ON demo_seed_data(demo_account_id);
CREATE INDEX IF NOT EXISTS idx_demo_seed_data_type ON demo_seed_data(data_type);

-- Partial indexes on role tables for efficient demo user lookups
CREATE INDEX IF NOT EXISTS idx_students_is_demo ON students(is_demo_user) WHERE is_demo_user = true;
CREATE INDEX IF NOT EXISTS idx_teachers_is_demo ON teachers(is_demo_user) WHERE is_demo_user = true;
CREATE INDEX IF NOT EXISTS idx_guardians_is_demo ON guardians(is_demo_user) WHERE is_demo_user = true;

-- =============================================================================
-- 5. Updated_at trigger for demo_accounts
-- =============================================================================

CREATE OR REPLACE FUNCTION update_demo_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_demo_accounts_updated_at ON demo_accounts;
CREATE TRIGGER trg_demo_accounts_updated_at
  BEFORE UPDATE ON demo_accounts
  FOR EACH ROW EXECUTE FUNCTION update_demo_accounts_updated_at();

-- =============================================================================
-- 6. Feature flag for demo mode
-- =============================================================================

-- Insert demo_mode flag if it doesn't already exist.
-- feature_flags may or may not have a UNIQUE constraint on flag_name,
-- so we use a DO block for safety.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'demo_mode') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, target_roles)
    VALUES ('demo_mode', true, '{super_admin}');
  END IF;
END $$;

-- =============================================================================
-- 7. RPC: reset_demo_account
-- =============================================================================

-- SECURITY DEFINER justification: This function deletes/resets data across
-- multiple tables for demo accounts. It must bypass RLS since demo account
-- management is an admin-only operation invoked via service role from
-- super-admin API routes. The function validates the target is an active
-- demo account before performing any mutations.
CREATE OR REPLACE FUNCTION reset_demo_account(p_demo_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo demo_accounts;
  v_student_id UUID;
  v_result JSONB := '{}';
BEGIN
  -- Get demo account; only active demo accounts can be reset
  SELECT * INTO v_demo
  FROM demo_accounts
  WHERE id = p_demo_account_id AND is_active = true;

  IF v_demo IS NULL THEN
    RETURN jsonb_build_object('error', 'Demo account not found or inactive');
  END IF;

  IF v_demo.role = 'student' THEN
    -- Get student ID from auth_user_id
    SELECT id INTO v_student_id
    FROM students
    WHERE auth_user_id = v_demo.auth_user_id;

    IF v_student_id IS NOT NULL THEN
      -- Clear quiz results for this demo student
      DELETE FROM quiz_results WHERE student_id = v_student_id;

      -- Clear daily usage records
      DELETE FROM student_daily_usage WHERE student_id = v_student_id;

      -- Reset learning profile progress (XP, sessions, streaks)
      UPDATE student_learning_profiles
      SET xp = 0,
          level = 1,
          total_sessions = 0,
          total_questions_asked = 0,
          total_questions_answered_correctly = 0,
          total_time_minutes = 0,
          streak_days = 0,
          longest_streak = 0,
          last_session_at = NULL,
          updated_at = now()
      WHERE student_id = v_student_id;

      -- Reset student-level stats
      UPDATE students
      SET xp_total = 0,
          streak_days = 0,
          last_active = NULL,
          updated_at = now()
      WHERE id = v_student_id;
    END IF;
  END IF;

  -- Update reset timestamp on the demo account
  UPDATE demo_accounts
  SET last_reset_at = now(),
      updated_at = now()
  WHERE id = p_demo_account_id;

  v_result := jsonb_build_object(
    'success', true,
    'account_id', p_demo_account_id,
    'role', v_demo.role,
    'reset_at', now()
  );

  RETURN v_result;
END;
$$;
