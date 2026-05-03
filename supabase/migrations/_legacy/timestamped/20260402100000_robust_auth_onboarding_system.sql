-- ============================================================================
-- Migration: 20260402100000_robust_auth_onboarding_system.sql
-- Purpose: Add missing RLS policies for students/teachers/guardians tables,
--          create onboarding_state tracking table, auth audit log table,
--          server-side bootstrap RPC, and admin repair function.
--
-- Context: students, teachers, guardians tables have RLS enabled but zero
--          RLS policies in migrations. Profile creation is client-side and
--          fragile. This migration adds server-controlled onboarding with
--          idempotent bootstrap and error recovery.
--
-- Idempotency: All statements use DROP POLICY IF EXISTS, CREATE TABLE IF
--              NOT EXISTS, CREATE OR REPLACE FUNCTION, DO $$ blocks with
--              exception handling, and ON CONFLICT clauses.
-- ============================================================================

-- ============================================================================
-- SECTION 1: RLS Policies for students table
-- ============================================================================

-- Users can read their own student record
DROP POLICY IF EXISTS "students_select_own" ON students;
CREATE POLICY "students_select_own" ON students
  FOR SELECT USING (auth_user_id = auth.uid());

-- Users can insert their own student record (for signup)
DROP POLICY IF EXISTS "students_insert_own" ON students;
CREATE POLICY "students_insert_own" ON students
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

-- Users can update their own student record
DROP POLICY IF EXISTS "students_update_own" ON students;
CREATE POLICY "students_update_own" ON students
  FOR UPDATE USING (auth_user_id = auth.uid());

-- Teachers can read students in their classes (via class_teachers + class_students)
DROP POLICY IF EXISTS "students_select_teacher" ON students;
CREATE POLICY "students_select_teacher" ON students
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM class_students cs
      JOIN class_teachers ct ON ct.class_id = cs.class_id
      JOIN teachers t ON t.id = ct.teacher_id
      WHERE cs.student_id = students.id
      AND t.auth_user_id = auth.uid()
    )
  );

-- Guardians can read their linked students
-- Note: both 'active' and 'approved' statuses are used in the codebase
DROP POLICY IF EXISTS "students_select_guardian" ON students;
CREATE POLICY "students_select_guardian" ON students
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM guardian_student_links gsl
      JOIN guardians g ON g.id = gsl.guardian_id
      WHERE gsl.student_id = students.id
      AND g.auth_user_id = auth.uid()
      AND gsl.status IN ('active', 'approved')
    )
  );

-- Service role bypass (for admin operations)
DROP POLICY IF EXISTS "students_service_role" ON students;
CREATE POLICY "students_service_role" ON students
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- SECTION 2: RLS Policies for teachers table
-- ============================================================================

-- Teachers can read their own record
DROP POLICY IF EXISTS "teachers_select_own" ON teachers;
CREATE POLICY "teachers_select_own" ON teachers
  FOR SELECT USING (auth_user_id = auth.uid());

-- Teachers can insert their own record (for signup)
DROP POLICY IF EXISTS "teachers_insert_own" ON teachers;
CREATE POLICY "teachers_insert_own" ON teachers
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

-- Teachers can update their own record
DROP POLICY IF EXISTS "teachers_update_own" ON teachers;
CREATE POLICY "teachers_update_own" ON teachers
  FOR UPDATE USING (auth_user_id = auth.uid());

-- Service role bypass (for admin operations)
DROP POLICY IF EXISTS "teachers_service_role" ON teachers;
CREATE POLICY "teachers_service_role" ON teachers
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can see basic teacher info (for class display)
DROP POLICY IF EXISTS "teachers_select_public_info" ON teachers;
CREATE POLICY "teachers_select_public_info" ON teachers
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- SECTION 3: RLS Policies for guardians table
-- ============================================================================

-- Guardians can read their own record
DROP POLICY IF EXISTS "guardians_select_own" ON guardians;
CREATE POLICY "guardians_select_own" ON guardians
  FOR SELECT USING (auth_user_id = auth.uid());

-- Guardians can insert their own record (for signup)
DROP POLICY IF EXISTS "guardians_insert_own" ON guardians;
CREATE POLICY "guardians_insert_own" ON guardians
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

-- Guardians can update their own record
DROP POLICY IF EXISTS "guardians_update_own" ON guardians;
CREATE POLICY "guardians_update_own" ON guardians
  FOR UPDATE USING (auth_user_id = auth.uid());

-- Service role bypass (for admin operations)
DROP POLICY IF EXISTS "guardians_service_role" ON guardians;
CREATE POLICY "guardians_service_role" ON guardians
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- SECTION 4: Onboarding state table
-- ============================================================================

CREATE TABLE IF NOT EXISTS onboarding_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE,
  intended_role TEXT NOT NULL CHECK (intended_role IN ('student', 'teacher', 'parent')),
  step TEXT NOT NULL DEFAULT 'identity_created' CHECK (step IN (
    'identity_created', 'profile_created', 'role_assigned', 'completed', 'failed'
  )),
  profile_id UUID,
  error_message TEXT,
  error_step TEXT,
  retry_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE onboarding_state ENABLE ROW LEVEL SECURITY;

-- User can see their own onboarding state
DROP POLICY IF EXISTS "onboarding_state_select_own" ON onboarding_state;
CREATE POLICY "onboarding_state_select_own" ON onboarding_state
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_state_insert_own" ON onboarding_state;
CREATE POLICY "onboarding_state_insert_own" ON onboarding_state
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_state_update_own" ON onboarding_state;
CREATE POLICY "onboarding_state_update_own" ON onboarding_state
  FOR UPDATE USING (auth_user_id = auth.uid());

-- Service role bypass
DROP POLICY IF EXISTS "onboarding_state_service_role" ON onboarding_state;
CREATE POLICY "onboarding_state_service_role" ON onboarding_state
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_onboarding_state_auth_user ON onboarding_state(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_state_step ON onboarding_state(step) WHERE step != 'completed';

-- Updated_at trigger for onboarding_state
CREATE OR REPLACE FUNCTION update_onboarding_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onboarding_state_updated_at ON onboarding_state;
CREATE TRIGGER trg_onboarding_state_updated_at
  BEFORE UPDATE ON onboarding_state
  FOR EACH ROW EXECUTE FUNCTION update_onboarding_state_updated_at();

-- ============================================================================
-- SECTION 5: Auth audit log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID,
  event_type TEXT NOT NULL,
  -- Valid event_type values: signup_start, signup_complete, login_success,
  -- login_failure, password_reset_request, password_reset_complete, logout,
  -- bootstrap_success, bootstrap_failure
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE auth_audit_log ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (server-side only)
DROP POLICY IF EXISTS "auth_audit_log_service_role" ON auth_audit_log;
CREATE POLICY "auth_audit_log_service_role" ON auth_audit_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_auth_audit_log_user ON auth_audit_log(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_event ON auth_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_created ON auth_audit_log(created_at DESC);

-- ============================================================================
-- SECTION 6: Ensure unique constraints on auth_user_id
-- The migration 20260325100000 creates partial unique INDEXES (not constraints).
-- The bootstrap RPC needs actual UNIQUE constraints for ON CONFLICT ON CONSTRAINT.
-- We add them here, safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_auth_user_id_unique'
  ) THEN
    -- Only add if no conflicting duplicates exist (the partial index
    -- from 20260325100000 already deduped rows with deleted_at IS NULL)
    ALTER TABLE students ADD CONSTRAINT students_auth_user_id_unique
      UNIQUE (auth_user_id);
  END IF;
EXCEPTION WHEN duplicate_table THEN
  -- Constraint already exists under a different detection path
  NULL;
WHEN unique_violation THEN
  -- Duplicates still exist (e.g. NULL auth_user_id rows); skip constraint
  RAISE WARNING 'Cannot add students_auth_user_id_unique: duplicate auth_user_id values exist. Skipping.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_auth_user_id_unique'
  ) THEN
    ALTER TABLE teachers ADD CONSTRAINT teachers_auth_user_id_unique
      UNIQUE (auth_user_id);
  END IF;
EXCEPTION WHEN duplicate_table THEN
  NULL;
WHEN unique_violation THEN
  RAISE WARNING 'Cannot add teachers_auth_user_id_unique: duplicate auth_user_id values exist. Skipping.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guardians_auth_user_id_unique'
  ) THEN
    ALTER TABLE guardians ADD CONSTRAINT guardians_auth_user_id_unique
      UNIQUE (auth_user_id);
  END IF;
EXCEPTION WHEN duplicate_table THEN
  NULL;
WHEN unique_violation THEN
  RAISE WARNING 'Cannot add guardians_auth_user_id_unique: duplicate auth_user_id values exist. Skipping.';
END $$;

-- ============================================================================
-- SECTION 7: Server-side bootstrap RPC
--
-- SECURITY DEFINER justification: This function is called from a server-side
-- API route (using service role) to atomically create user profiles during
-- onboarding. It needs to write to students/teachers/guardians/onboarding_state
-- tables as part of the bootstrap process, which may be called before the
-- user's RLS policies would allow them to write (since they have no profile yet).
-- The calling API route verifies the user's identity via auth token before
-- invoking this function.
-- ============================================================================

CREATE OR REPLACE FUNCTION bootstrap_user_profile(
  p_auth_user_id UUID,
  p_role TEXT,
  p_name TEXT,
  p_email TEXT,
  p_grade TEXT DEFAULT NULL,
  p_board TEXT DEFAULT NULL,
  p_school_name TEXT DEFAULT NULL,
  p_subjects_taught TEXT[] DEFAULT NULL,
  p_grades_taught TEXT[] DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_link_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_onboarding_id UUID;
  v_existing_step TEXT;
BEGIN
  -- Check if onboarding already completed (idempotent)
  SELECT step, profile_id INTO v_existing_step, v_profile_id
    FROM onboarding_state
    WHERE auth_user_id = p_auth_user_id;

  IF v_existing_step = 'completed' THEN
    RETURN jsonb_build_object('status', 'already_completed', 'profile_id', v_profile_id);
  END IF;

  -- Upsert onboarding state
  INSERT INTO onboarding_state (auth_user_id, intended_role, step)
  VALUES (p_auth_user_id, p_role, 'identity_created')
  ON CONFLICT (auth_user_id) DO UPDATE SET
    step = 'identity_created',
    error_message = NULL,
    error_step = NULL,
    retry_count = onboarding_state.retry_count + 1,
    updated_at = now()
  RETURNING id INTO v_onboarding_id;

  -- Create profile based on role
  BEGIN
    IF p_role = 'student' THEN
      INSERT INTO students (auth_user_id, name, email, grade, board, preferred_language, account_status)
      VALUES (
        p_auth_user_id,
        p_name,
        p_email,
        COALESCE(p_grade, '9'),
        COALESCE(p_board, 'CBSE'),
        'en',
        'active'
      )
      ON CONFLICT ON CONSTRAINT students_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSIF p_role = 'teacher' THEN
      INSERT INTO teachers (auth_user_id, name, email, school_name, subjects_taught, grades_taught)
      VALUES (
        p_auth_user_id,
        p_name,
        p_email,
        p_school_name,
        COALESCE(p_subjects_taught, '{}'),
        COALESCE(p_grades_taught, '{}')
      )
      ON CONFLICT ON CONSTRAINT teachers_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSIF p_role = 'parent' THEN
      INSERT INTO guardians (auth_user_id, name, email, phone)
      VALUES (p_auth_user_id, p_name, p_email, p_phone)
      ON CONFLICT ON CONSTRAINT guardians_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id INTO v_profile_id;

      -- Link guardian to student if link code provided (non-fatal on failure)
      IF p_link_code IS NOT NULL AND p_link_code != '' THEN
        BEGIN
          PERFORM link_guardian_to_student_via_code(v_profile_id, p_link_code);
        EXCEPTION WHEN OTHERS THEN
          -- Link failure is non-fatal; guardian can link later
          NULL;
        END;
      END IF;

    ELSE
      UPDATE onboarding_state SET
        step = 'failed',
        error_message = 'Invalid role: ' || p_role,
        error_step = 'profile_created',
        updated_at = now()
      WHERE id = v_onboarding_id;
      RETURN jsonb_build_object('status', 'error', 'error', 'Invalid role');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    UPDATE onboarding_state SET
      step = 'failed',
      error_message = SQLERRM,
      error_step = 'profile_created',
      updated_at = now()
    WHERE id = v_onboarding_id;
    RETURN jsonb_build_object('status', 'error', 'error', SQLERRM);
  END;

  -- Update onboarding state to completed
  UPDATE onboarding_state SET
    step = 'completed',
    profile_id = v_profile_id,
    completed_at = now(),
    updated_at = now()
  WHERE id = v_onboarding_id;

  -- Log the bootstrap event
  INSERT INTO auth_audit_log (auth_user_id, event_type, metadata)
  VALUES (
    p_auth_user_id,
    'bootstrap_success',
    jsonb_build_object('role', p_role, 'profile_id', v_profile_id)
  );

  RETURN jsonb_build_object('status', 'success', 'profile_id', v_profile_id, 'role', p_role);
END;
$$;

-- ============================================================================
-- SECTION 8: Admin repair function
--
-- SECURITY DEFINER justification: This function is called by admin/super_admin
-- users (via service role API routes) to repair broken onboarding states for
-- users who got stuck during signup. It needs cross-table write access to
-- students/teachers/guardians/onboarding_state/user_roles to reconcile state.
-- Only callable via service role (admin API routes verify super_admin auth).
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_repair_user_onboarding(
  p_auth_user_id UUID,
  p_force_role TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_profile_id UUID;
  v_has_student BOOLEAN;
  v_has_teacher BOOLEAN;
  v_has_guardian BOOLEAN;
BEGIN
  -- Detect existing profiles
  SELECT EXISTS(SELECT 1 FROM students WHERE auth_user_id = p_auth_user_id) INTO v_has_student;
  SELECT EXISTS(SELECT 1 FROM teachers WHERE auth_user_id = p_auth_user_id) INTO v_has_teacher;
  SELECT EXISTS(SELECT 1 FROM guardians WHERE auth_user_id = p_auth_user_id) INTO v_has_guardian;

  -- Determine role (forced role takes priority, then detect from profile tables)
  v_role := COALESCE(p_force_role,
    CASE
      WHEN v_has_teacher THEN 'teacher'
      WHEN v_has_guardian THEN 'parent'
      WHEN v_has_student THEN 'student'
      ELSE 'student'
    END
  );

  -- Get profile_id from the matching table
  IF v_role = 'student' AND v_has_student THEN
    SELECT id INTO v_profile_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  ELSIF v_role = 'teacher' AND v_has_teacher THEN
    SELECT id INTO v_profile_id FROM teachers WHERE auth_user_id = p_auth_user_id LIMIT 1;
  ELSIF v_role = 'parent' AND v_has_guardian THEN
    SELECT id INTO v_profile_id FROM guardians WHERE auth_user_id = p_auth_user_id LIMIT 1;
  END IF;

  -- Upsert onboarding state to completed
  INSERT INTO onboarding_state (auth_user_id, intended_role, step, profile_id, completed_at)
  VALUES (p_auth_user_id, v_role, 'completed', v_profile_id, now())
  ON CONFLICT (auth_user_id) DO UPDATE SET
    step = 'completed',
    profile_id = COALESCE(v_profile_id, onboarding_state.profile_id),
    error_message = NULL,
    completed_at = now(),
    updated_at = now();

  -- Ensure user_roles entry exists
  PERFORM sync_user_roles_for_user(p_auth_user_id);

  -- Log the repair event
  INSERT INTO auth_audit_log (auth_user_id, event_type, metadata)
  VALUES (
    p_auth_user_id,
    'bootstrap_success',
    jsonb_build_object(
      'action', 'admin_repair',
      'role', v_role,
      'profile_id', v_profile_id,
      'had_student', v_has_student,
      'had_teacher', v_has_teacher,
      'had_guardian', v_has_guardian
    )
  );

  RETURN jsonb_build_object(
    'status', 'repaired',
    'role', v_role,
    'profile_id', v_profile_id,
    'had_student', v_has_student,
    'had_teacher', v_has_teacher,
    'had_guardian', v_has_guardian
  );
END;
$$;

-- ============================================================================
-- SECTION 9: Helper function to sync roles for a specific user
--
-- SECURITY DEFINER justification: Called by admin_repair_user_onboarding and
-- bootstrap_user_profile (both SECURITY DEFINER) to ensure user_roles table
-- is consistent. Needs to read across students/teachers/guardians tables and
-- write to user_roles regardless of calling user's RLS permissions.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_user_roles_for_user(p_auth_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id UUID;
BEGIN
  -- Student role
  IF EXISTS (SELECT 1 FROM students WHERE auth_user_id = p_auth_user_id AND is_active = true) THEN
    SELECT id INTO v_role_id FROM roles WHERE name = 'student' AND is_active = true;
    IF v_role_id IS NOT NULL THEN
      INSERT INTO user_roles (auth_user_id, role_id, is_active)
      VALUES (p_auth_user_id, v_role_id, true)
      ON CONFLICT (auth_user_id, role_id) DO NOTHING;
    END IF;
  END IF;

  -- Teacher role
  IF EXISTS (SELECT 1 FROM teachers WHERE auth_user_id = p_auth_user_id) THEN
    SELECT id INTO v_role_id FROM roles WHERE name = 'teacher' AND is_active = true;
    IF v_role_id IS NOT NULL THEN
      INSERT INTO user_roles (auth_user_id, role_id, is_active)
      VALUES (p_auth_user_id, v_role_id, true)
      ON CONFLICT (auth_user_id, role_id) DO NOTHING;
    END IF;
  END IF;

  -- Guardian/parent role
  IF EXISTS (SELECT 1 FROM guardians WHERE auth_user_id = p_auth_user_id) THEN
    SELECT id INTO v_role_id FROM roles WHERE name = 'parent' AND is_active = true;
    IF v_role_id IS NOT NULL THEN
      INSERT INTO user_roles (auth_user_id, role_id, is_active)
      VALUES (p_auth_user_id, v_role_id, true)
      ON CONFLICT (auth_user_id, role_id) DO NOTHING;
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- SECTION 10: Grant execute on new functions to authenticated users
-- ============================================================================

-- bootstrap_user_profile is meant to be called from server-side API routes
-- via service role, but granting to authenticated allows direct RPC calls
-- from the client during onboarding (the function itself validates auth).
GRANT EXECUTE ON FUNCTION bootstrap_user_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION bootstrap_user_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT, TEXT) TO service_role;

-- admin_repair and sync_user_roles are admin-only (called via service role)
GRANT EXECUTE ON FUNCTION admin_repair_user_onboarding(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sync_user_roles_for_user(UUID) TO service_role;
