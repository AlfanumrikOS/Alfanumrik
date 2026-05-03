-- ============================================================================
-- Migration: 20260402110000_demo_accounts_tables_and_rpc.sql
-- Purpose: Create demo_accounts and demo_seed_data tables (referenced by
--          super-admin demo API route but missing from migrations).
--          Also creates reset_demo_account RPC (wrapper around reset_demo_student).
-- ============================================================================

-- 1. demo_accounts registry table
CREATE TABLE IF NOT EXISTS demo_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'parent')),
  persona TEXT DEFAULT 'average' CHECK (persona IN ('weak', 'average', 'high_performer')),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE demo_accounts ENABLE ROW LEVEL SECURITY;

-- Only service role can access demo_accounts (admin operations)
DROP POLICY IF EXISTS "demo_accounts_service_role" ON demo_accounts;
CREATE POLICY "demo_accounts_service_role" ON demo_accounts
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_demo_accounts_auth_user ON demo_accounts(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_demo_accounts_role ON demo_accounts(role);
CREATE INDEX IF NOT EXISTS idx_demo_accounts_active ON demo_accounts(is_active) WHERE is_active = true;

-- 2. demo_seed_data table (stores persona snapshots for reset)
CREATE TABLE IF NOT EXISTS demo_seed_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_account_id UUID NOT NULL REFERENCES demo_accounts(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL,
  seed_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE demo_seed_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_seed_data_service_role" ON demo_seed_data;
CREATE POLICY "demo_seed_data_service_role" ON demo_seed_data
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_demo_seed_data_account ON demo_seed_data(demo_account_id);

-- 3. reset_demo_account RPC -- wraps reset_demo_student for any role
-- The admin API route calls reset_demo_account RPC (lines 567, 650 of
-- src/app/api/super-admin/demo-accounts/route.ts), but only reset_demo_student
-- exists in the database. This creates a general-purpose wrapper.
-- SECURITY DEFINER: Required because this function reads demo_accounts and
-- delegates to reset_demo_student (which itself deletes across tables the
-- caller does not own via RLS). Called via service role from the API route,
-- so no admin_users check is needed here (the API route enforces auth).
CREATE OR REPLACE FUNCTION reset_demo_account(p_demo_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account RECORD;
  v_student_id UUID;
  v_result JSONB;
BEGIN
  -- Look up demo account
  SELECT * INTO v_account FROM demo_accounts WHERE id = p_demo_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Demo account not found');
  END IF;

  IF v_account.role = 'student' THEN
    -- Find the student profile
    SELECT id INTO v_student_id FROM students
    WHERE auth_user_id = v_account.auth_user_id AND is_demo = true LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      -- Delegate to existing reset_demo_student RPC (avoids duplicating logic)
      v_result := reset_demo_student(v_student_id);
      RETURN v_result;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Demo student profile not found');
    END IF;

  ELSIF v_account.role = 'teacher' THEN
    -- Reset teacher: touch updated_at to signal reset occurred
    -- Teachers have minimal activity data to clear
    UPDATE teachers SET
      updated_at = now()
    WHERE auth_user_id = v_account.auth_user_id AND is_demo = true;

    RETURN jsonb_build_object('success', true, 'role', 'teacher', 'reset_at', now());

  ELSIF v_account.role = 'parent' THEN
    -- Reset parent: keep guardian profile and links
    UPDATE guardians SET
      updated_at = now()
    WHERE auth_user_id = v_account.auth_user_id AND is_demo = true;

    RETURN jsonb_build_object('success', true, 'role', 'parent', 'reset_at', now());
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unknown role');
  END IF;
END;
$$;

-- 4. Updated_at trigger for demo_accounts
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
