-- Migration: 20260412150000_white_label_schools.sql
-- Purpose: Extend schools table with white-label branding columns, create school
--          subscriptions and invite codes tables, add institution_admin-scoped
--          RLS helper function.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
--              CREATE OR REPLACE FUNCTION, DO $$ blocks with exception handling.

-- ============================================================================
-- 1. Extend schools table with branding columns
-- ============================================================================

ALTER TABLE schools ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#7C3AED';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#F97316';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS tagline TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS billing_email TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- Add unique constraint on slug (idempotent)
DO $$ BEGIN
  ALTER TABLE schools ADD CONSTRAINT schools_slug_unique UNIQUE (slug);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Generate slugs from existing school names (lowercase, hyphenated, trimmed trailing hyphens)
UPDATE schools
SET slug = regexp_replace(
  lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')),
  '-+$', '', 'g'
)
WHERE slug IS NULL AND name IS NOT NULL;

-- Index on slug for middleware lookups (partial: only active schools)
CREATE INDEX IF NOT EXISTS idx_schools_slug_active ON schools (slug) WHERE is_active = true;

-- ============================================================================
-- 2. School subscriptions table (institutional billing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS school_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  seats_purchased INT NOT NULL DEFAULT 50,
  price_per_seat_monthly NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trial', 'expired', 'cancelled')),
  razorpay_subscription_id TEXT,
  current_period_start TIMESTAMPTZ DEFAULT now(),
  current_period_end TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_subscriptions_school
  ON school_subscriptions (school_id);

ALTER TABLE school_subscriptions ENABLE ROW LEVEL SECURITY;

-- Admin-only: no direct anon/authenticated access; service role bypasses RLS.
-- Institution admins manage subscriptions through API routes (service role).
DO $$ BEGIN
  CREATE POLICY "school_subscriptions_deny_all" ON school_subscriptions
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_school_subscriptions_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_subscriptions_updated_at ON school_subscriptions;
CREATE TRIGGER trg_school_subscriptions_updated_at
  BEFORE UPDATE ON school_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_school_subscriptions_updated_at();

-- ============================================================================
-- 3. School invite codes table
-- ============================================================================

CREATE TABLE IF NOT EXISTS school_invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
  class_id UUID REFERENCES classes(id),
  max_uses INT DEFAULT 100,
  uses_count INT DEFAULT 0,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '90 days'),
  created_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_invite_codes_code_active
  ON school_invite_codes (code) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_school_invite_codes_school
  ON school_invite_codes (school_id);

ALTER TABLE school_invite_codes ENABLE ROW LEVEL SECURITY;

-- Admin-only: managed through API routes with service role.
DO $$ BEGIN
  CREATE POLICY "school_invite_codes_deny_all" ON school_invite_codes
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 4. Helper function: get the caller's school_id via teachers table
-- ============================================================================

-- SECURITY DEFINER justification: This function is used in RLS policies to
-- resolve the institution_admin's school_id from the teachers table. Without
-- SECURITY DEFINER, RLS on the teachers table itself would create a circular
-- dependency (policy on students needs to read teachers, but teachers has its
-- own RLS). The function only returns a single UUID and performs no mutations.
CREATE OR REPLACE FUNCTION get_admin_school_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT school_id FROM teachers
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- ============================================================================
-- 5. RLS policy for schools table (institution_admin reads own school)
-- ============================================================================

-- Schools table currently has RLS enabled but no policies.
-- Allow institution admins to read their own school; other roles access
-- schools through API routes (service role). Public read for slug lookup
-- is also needed for the middleware subdomain resolution (via service role,
-- but we add a minimal authenticated read for admin UI).
DO $$ BEGIN
  CREATE POLICY "schools_select_own" ON schools
    FOR SELECT TO authenticated
    USING (
      id = get_admin_school_id()
      OR EXISTS (
        SELECT 1 FROM students WHERE students.school_id = schools.id
        AND students.auth_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role bypass for schools
DO $$ BEGIN
  CREATE POLICY "schools_service_role" ON schools
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 6. NOTE ON students/teachers RLS FOR institution_admin
-- ============================================================================
-- The existing RLS policies on students and teachers are:
--
-- students: "students_select_merged" (own + is_teacher_of + is_guardian_of)
--           "students_insert_own", "students_update_own", "students_service_role"
--
-- teachers: "teachers_select_merged" (own + any authenticated)
--           "teachers_insert_own", "teachers_update_own", "teachers_service_role"
--
-- Adding a separate institution_admin SELECT policy would create multiple
-- permissive SELECT policies on the same table (which was specifically cleaned
-- up in migration 20260408000021). Instead, institution_admin access to
-- students/teachers in their school is handled via:
--   1. API routes using service role (bypasses RLS)
--   2. The existing "teachers_select_merged" already lets any authenticated
--      user read teachers (institution_admin is authenticated)
--   3. For students: institution_admin uses service role through API routes
--      with authorizeRequest('institution.manage_students')
--
-- This avoids RLS policy conflicts while maintaining security through RBAC.