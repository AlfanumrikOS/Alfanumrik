-- Migration: 20260416240000_school_admins_table.sql
-- Purpose: Create the school_admins table that links auth users to schools
--          as administrators. Referenced by school-admin-auth.ts, all
--          school-admin portal pages, and the get_admin_school_id() helper.

-- ============================================================================
-- 1. school_admins table
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  auth_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'admin',
  name          TEXT,
  email         TEXT,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one admin record per user per school
DO $$ BEGIN
  ALTER TABLE school_admins ADD CONSTRAINT school_admins_school_user_unique
    UNIQUE (school_id, auth_user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_school_admins_school_id
  ON school_admins (school_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_school_admins_auth_user_id
  ON school_admins (auth_user_id) WHERE is_active = true;

-- ============================================================================
-- 3. RLS (P8: every new table must have RLS enabled in the same migration)
-- ============================================================================
ALTER TABLE school_admins ENABLE ROW LEVEL SECURITY;

-- Service role full access (API routes use service role for admin operations)
DO $$ BEGIN
  CREATE POLICY "school_admins_service_role" ON school_admins
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Authenticated admin can SELECT own school's records
DO $$ BEGIN
  CREATE POLICY "school_admins_self_select" ON school_admins
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- School admins can view other admins in the same school
DO $$ BEGIN
  CREATE POLICY "school_admins_same_school_select" ON school_admins
    FOR SELECT TO authenticated
    USING (
      school_id IN (
        SELECT sa.school_id FROM school_admins sa
        WHERE sa.auth_user_id = auth.uid()
          AND sa.is_active = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 4. Updated_at trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION update_school_admins_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_admins_updated_at ON school_admins;
CREATE TRIGGER trg_school_admins_updated_at
  BEFORE UPDATE ON school_admins
  FOR EACH ROW EXECUTE FUNCTION update_school_admins_updated_at();

-- ============================================================================
-- 5. Update get_admin_school_id() to check school_admins first, then teachers
--    This makes the RLS helper consistent with the app's auth lookup order.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_admin_school_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT school_id FROM school_admins
     WHERE auth_user_id = auth.uid() AND is_active = true
     LIMIT 1),
    (SELECT school_id FROM teachers
     WHERE auth_user_id = auth.uid()
     LIMIT 1)
  )
$$;
