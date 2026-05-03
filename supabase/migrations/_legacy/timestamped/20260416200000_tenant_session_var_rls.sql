-- Migration: 20260416200000_tenant_session_var_rls.sql
-- Purpose: Session-variable tenant isolation + school_id denormalization
-- Applied via Supabase MCP on 2026-04-16

-- 1. Helper function: get current tenant school_id
CREATE OR REPLACE FUNCTION current_school_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.current_school_id', true), '')::UUID;
$$;

COMMENT ON FUNCTION current_school_id() IS
  'Returns the current tenant school_id from the Postgres session variable.';

-- 2. RPC to set tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(p_school_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.current_school_id', p_school_id::text, true);
END;
$$;

-- 3. Domain verification columns on schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN DEFAULT false;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS domain_verification_token TEXT;

CREATE INDEX IF NOT EXISTS idx_schools_custom_domain_active
  ON schools (custom_domain)
  WHERE custom_domain IS NOT NULL AND is_active = true AND deleted_at IS NULL;

-- 4. Denormalize school_id onto quiz_sessions
DO $$ BEGIN
  ALTER TABLE quiz_sessions ADD COLUMN school_id UUID REFERENCES schools(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

UPDATE quiz_sessions qs
SET school_id = s.school_id
FROM students s
WHERE qs.student_id = s.id
  AND qs.school_id IS NULL
  AND s.school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_school_id
  ON quiz_sessions (school_id)
  WHERE school_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_quiz_session_school_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT school_id INTO NEW.school_id FROM students WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quiz_sessions_set_school_id ON quiz_sessions;
CREATE TRIGGER trg_quiz_sessions_set_school_id
  BEFORE INSERT ON quiz_sessions
  FOR EACH ROW EXECUTE FUNCTION set_quiz_session_school_id();

-- 5. Denormalize school_id onto student_learning_profiles
DO $$ BEGIN
  ALTER TABLE student_learning_profiles ADD COLUMN school_id UUID REFERENCES schools(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

UPDATE student_learning_profiles slp
SET school_id = s.school_id
FROM students s
WHERE slp.student_id = s.id
  AND slp.school_id IS NULL
  AND s.school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slp_school_id
  ON student_learning_profiles (school_id)
  WHERE school_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_slp_school_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT school_id INTO NEW.school_id FROM students WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slp_set_school_id ON student_learning_profiles;
CREATE TRIGGER trg_slp_set_school_id
  BEFORE INSERT ON student_learning_profiles
  FOR EACH ROW EXECUTE FUNCTION set_slp_school_id();