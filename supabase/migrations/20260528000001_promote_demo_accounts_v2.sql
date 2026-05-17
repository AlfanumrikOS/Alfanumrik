-- ============================================================================
-- Migration: 20260528000001_promote_demo_accounts_v2.sql
-- Phase F.1 + F.3 (Super-Admin Production-Readiness Plan, 2026-05-17)
-- Purpose:
--   1. Promote the quarantined legacy `demo_accounts` + `demo_seed_data` tables
--      and `reset_demo_account` RPC into the active migration set so the
--      super-admin demo creation flow stops 500-ing on every request.
--   2. Extend the schema to support five demo personas (student, teacher,
--      parent, school_admin, super_admin) and the `weak_student` persona
--      label (replaces the legacy `weak`).
--   3. Add `is_demo` columns to `admin_users`, `schools`, `student_subscriptions`,
--      `school_subscriptions` so the daily purge cron can cascade-clean
--      demo data without touching real tenants.
--
-- Backward compatibility:
--   - All new columns are nullable / defaulted; pre-existing rows unaffected.
--   - The `weak` persona value continues to be accepted in this migration
--     for any in-flight data; application code normalises to `weak_student`
--     and a follow-up migration will drop `weak` from the CHECK once all
--     code paths have been swapped (tracked separately).
--   - The `demo_accounts` table CHECK constraint is widened, not narrowed,
--     so any existing rows in lower environments survive replay.
-- ============================================================================

-- 1. demo_accounts registry table -------------------------------------------
CREATE TABLE IF NOT EXISTS demo_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    UUID NOT NULL,
  role            TEXT NOT NULL,
  persona         TEXT DEFAULT 'average',
  display_name    TEXT NOT NULL,
  email           TEXT NOT NULL,
  school_id       UUID NULL,
  is_active       BOOLEAN DEFAULT true,
  created_by      UUID NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  last_reset_at   TIMESTAMPTZ NULL
);

-- Widen role + persona CHECKs idempotently. Drop any pre-existing constraint
-- (legacy migration may have applied one), then re-add the v2 version.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demo_accounts_role_check' AND conrelid = 'demo_accounts'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE demo_accounts DROP CONSTRAINT demo_accounts_role_check';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demo_accounts_persona_check' AND conrelid = 'demo_accounts'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE demo_accounts DROP CONSTRAINT demo_accounts_persona_check';
  END IF;
END $$;

ALTER TABLE demo_accounts
  ADD CONSTRAINT demo_accounts_role_check
  CHECK (role IN ('student', 'teacher', 'parent', 'school_admin', 'super_admin'));

ALTER TABLE demo_accounts
  ADD CONSTRAINT demo_accounts_persona_check
  CHECK (persona IN ('weak', 'weak_student', 'average', 'high_performer') OR persona IS NULL);

-- New columns are idempotent (legacy migration didn't have them)
ALTER TABLE demo_accounts ADD COLUMN IF NOT EXISTS school_id     UUID NULL;
ALTER TABLE demo_accounts ADD COLUMN IF NOT EXISTS created_by    UUID NULL;
ALTER TABLE demo_accounts ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ NULL;

ALTER TABLE demo_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_accounts_service_role" ON demo_accounts;
CREATE POLICY "demo_accounts_service_role" ON demo_accounts
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_demo_accounts_auth_user ON demo_accounts(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_demo_accounts_role      ON demo_accounts(role);
CREATE INDEX IF NOT EXISTS idx_demo_accounts_active    ON demo_accounts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_demo_accounts_school    ON demo_accounts(school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demo_accounts_created   ON demo_accounts(created_at);

-- 2. demo_seed_data table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_seed_data (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_account_id UUID NOT NULL REFERENCES demo_accounts(id) ON DELETE CASCADE,
  data_type       TEXT NOT NULL,
  seed_data       JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE demo_seed_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_seed_data_service_role" ON demo_seed_data;
CREATE POLICY "demo_seed_data_service_role" ON demo_seed_data
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_demo_seed_data_account ON demo_seed_data(demo_account_id);

-- 3. is_demo columns on tenant + subscription tables ------------------------
-- Defaulted to false so the daily purge cron (separate migration) can scope
-- safely to is_demo=true and never touch real tenants.
ALTER TABLE admin_users           ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE school_admins         ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schools               ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE student_subscriptions ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE school_subscriptions  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_admin_users_is_demo
  ON admin_users(is_demo) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_school_admins_is_demo
  ON school_admins(is_demo) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_schools_is_demo
  ON schools(is_demo) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_student_subscriptions_is_demo
  ON student_subscriptions(is_demo) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_school_subscriptions_is_demo
  ON school_subscriptions(is_demo) WHERE is_demo = true;

-- 4. reset_demo_account RPC --------------------------------------------------
-- Resets a demo account back to its initial persona state. For students this
-- delegates to reset_demo_student (already in baseline); for teachers /
-- parents / admins it touches updated_at as a signal. School-admin reset
-- additionally clears classroom seed data and student progress under the
-- demo school.
--
-- SECURITY DEFINER: called via service role from the API route, which
-- enforces auth + admin level before invoking.
CREATE OR REPLACE FUNCTION reset_demo_account(p_demo_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account     RECORD;
  v_student_id  UUID;
  v_result      JSONB;
BEGIN
  SELECT * INTO v_account FROM demo_accounts WHERE id = p_demo_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Demo account not found');
  END IF;

  IF v_account.role = 'student' THEN
    SELECT id INTO v_student_id FROM students
      WHERE auth_user_id = v_account.auth_user_id AND is_demo = true LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      v_result := reset_demo_student(v_student_id);
    ELSE
      v_result := jsonb_build_object('success', false, 'error', 'Demo student profile not found');
    END IF;

  ELSIF v_account.role = 'teacher' THEN
    UPDATE teachers SET updated_at = now()
      WHERE auth_user_id = v_account.auth_user_id AND is_demo = true;
    v_result := jsonb_build_object('success', true, 'role', 'teacher');

  ELSIF v_account.role = 'parent' THEN
    UPDATE guardians SET updated_at = now()
      WHERE auth_user_id = v_account.auth_user_id AND is_demo = true;
    v_result := jsonb_build_object('success', true, 'role', 'parent');

  ELSIF v_account.role = 'super_admin' THEN
    UPDATE admin_users SET updated_at = now()
      WHERE auth_user_id = v_account.auth_user_id AND is_demo = true;
    v_result := jsonb_build_object('success', true, 'role', 'super_admin');

  ELSIF v_account.role = 'school_admin' THEN
    -- Reset every demo student under the demo school
    IF v_account.school_id IS NOT NULL THEN
      FOR v_student_id IN
        SELECT id FROM students
          WHERE school_id = v_account.school_id AND is_demo = true
      LOOP
        PERFORM reset_demo_student(v_student_id);
      END LOOP;
    END IF;
    UPDATE schools SET updated_at = now()
      WHERE id = v_account.school_id AND is_demo = true;
    v_result := jsonb_build_object('success', true, 'role', 'school_admin', 'school_id', v_account.school_id);

  ELSE
    v_result := jsonb_build_object('success', false, 'error', 'Unknown role');
  END IF;

  -- Stamp the reset timestamp on the registry so the UI can show "last reset"
  UPDATE demo_accounts
    SET last_reset_at = now(), updated_at = now()
    WHERE id = p_demo_account_id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION reset_demo_account(UUID) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reset_demo_account(UUID) TO service_role;

-- 5. updated_at trigger ------------------------------------------------------
CREATE OR REPLACE FUNCTION update_demo_accounts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demo_accounts_updated_at ON demo_accounts;
CREATE TRIGGER trg_demo_accounts_updated_at
  BEFORE UPDATE ON demo_accounts
  FOR EACH ROW EXECUTE FUNCTION update_demo_accounts_updated_at();
