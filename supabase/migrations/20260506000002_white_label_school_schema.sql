-- Migration: white_label_school_schema
-- Date: 2026-05-06
-- Purpose: Add white-label support to the schools table and relate students

-- 1. Add branding and domain fields to schools table
ALTER TABLE schools
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS primary_color varchar(7),
ADD COLUMN IF NOT EXISTS secondary_color varchar(7),
ADD COLUMN IF NOT EXISTS custom_domain text;

-- Add a unique constraint to custom_domain to support routing logic
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_custom_domain ON schools(custom_domain) WHERE custom_domain IS NOT NULL;

-- 2. Add school_id to students
ALTER TABLE students
ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id);

CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper: Extract school_id from JWT app_metadata for RLS policies
-- ─────────────────────────────────────────────────────────────────────────────
-- School admins/teachers will have school_id in their JWT:
--   auth.jwt() -> 'app_metadata' ->> 'school_id'
-- Students will have school_id in the students table (FK).
-- This function returns the school_id from JWT metadata, or NULL if unset.
CREATE OR REPLACE FUNCTION public.get_jwt_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'school_id'),
    ''
  )::uuid;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. School-scoped RLS on students table
-- ─────────────────────────────────────────────────────────────────────────────
-- School admins/teachers can only see students in their own school
DROP POLICY IF EXISTS "School staff can view own school students" ON public.students;
CREATE POLICY "School staff can view own school students"
  ON public.students FOR SELECT TO authenticated
  USING (
    -- Student can always see their own row
    auth_user_id = (SELECT auth.uid())
    -- School staff can see students from their school
    OR (school_id IS NOT NULL AND school_id = public.get_jwt_school_id())
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. School branding lookup — public read access for domain routing
-- ─────────────────────────────────────────────────────────────────────────────
-- The middleware needs to read school branding for custom domain mapping.
-- Only expose non-sensitive branding fields via a function.
CREATE OR REPLACE FUNCTION public.get_school_by_domain(p_domain text)
RETURNS TABLE (
  id uuid,
  name text,
  logo_url text,
  primary_color varchar(7),
  secondary_color varchar(7)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.logo_url, s.primary_color, s.secondary_color
  FROM schools s
  WHERE s.custom_domain = p_domain
    AND s.is_active = true
  LIMIT 1;
$$;
