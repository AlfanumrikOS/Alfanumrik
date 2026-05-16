-- 20260527000001_add_school_id_audit_logs.sql
--
-- Phase B.4 of multi-school prod-readiness plan.
--
-- audit_logs currently has auth_user_id (NULLABLE) but no school_id.
-- DPDP compliance and per-school operator queries need school-scoped
-- access to audit history; today every per-school query scans across all
-- tenants.
--
-- This migration:
--   1. Adds a NULLABLE school_id column with FK
--   2. Backfills from union of (students | teachers | school_admins).school_id
--      keyed on auth_user_id
--   3. Creates an index for per-school filtering
--   4. Adds a school-scoped RLS policy for school_admins
--   5. Trigger auto-populates school_id from the same union on INSERT
--
-- NOT NULL is deferred because:
--   - super-admin actions don't belong to a single school (NULL is correct)
--   - guest/anon actions exist
--   - B2C learners have no school
--
-- This complements but does NOT replace the existing school_audit_log table
-- (which is already school-scoped). audit_logs is the broader operational
-- audit; school_audit_log is the school-admin-specific subset.

BEGIN;

-- 1. Add nullable school_id column
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.audit_logs.school_id IS
  'Denormalized school_id for per-school filtering. Derived from the actor (students/teachers/school_admins) on INSERT. NULLABLE for super-admin/anon/B2C actions.';

-- 2. Backfill: try students -> teachers -> school_admins, in that order, by auth_user_id.
-- Use COALESCE on a CTE so a single UPDATE handles all three sources.
WITH actor_school AS (
  SELECT
    al.id AS audit_id,
    COALESCE(
      (SELECT s.school_id  FROM public.students      s  WHERE s.auth_user_id = al.auth_user_id AND s.school_id  IS NOT NULL LIMIT 1),
      (SELECT t.school_id  FROM public.teachers      t  WHERE t.auth_user_id = al.auth_user_id AND t.school_id  IS NOT NULL LIMIT 1),
      (SELECT sa.school_id FROM public.school_admins sa WHERE sa.auth_user_id = al.auth_user_id AND sa.school_id IS NOT NULL LIMIT 1)
    ) AS derived_school_id
  FROM public.audit_logs al
  WHERE al.school_id IS NULL
    AND al.auth_user_id IS NOT NULL
)
UPDATE public.audit_logs al
SET    school_id = actor_school.derived_school_id
FROM   actor_school
WHERE  al.id = actor_school.audit_id
  AND  actor_school.derived_school_id IS NOT NULL;

-- 3. Index for per-school + recency filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_school_id
  ON public.audit_logs (school_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_school_created
  ON public.audit_logs (school_id, created_at DESC)
  WHERE school_id IS NOT NULL;

-- 4. School-scoped RLS policy — school_admins of the matching school can SELECT
-- their school's audit history. Service-role bypass and existing
-- "auth_user_id = auth.uid()" policy preserved.
DROP POLICY IF EXISTS "school_admins_see_school_audit_logs" ON public.audit_logs;
CREATE POLICY "school_admins_see_school_audit_logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    school_id IS NOT NULL
    AND school_id IN (
      SELECT sa.school_id
      FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid()
        AND sa.is_active = true
    )
  );

-- 5. Trigger to auto-populate school_id on INSERT from the actor's school
CREATE OR REPLACE FUNCTION public.set_audit_log_school_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL AND NEW.auth_user_id IS NOT NULL THEN
    SELECT COALESCE(
      (SELECT s.school_id  FROM public.students      s  WHERE s.auth_user_id = NEW.auth_user_id AND s.school_id  IS NOT NULL LIMIT 1),
      (SELECT t.school_id  FROM public.teachers      t  WHERE t.auth_user_id = NEW.auth_user_id AND t.school_id  IS NOT NULL LIMIT 1),
      (SELECT sa.school_id FROM public.school_admins sa WHERE sa.auth_user_id = NEW.auth_user_id AND sa.school_id IS NOT NULL LIMIT 1)
    ) INTO NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_set_school_id ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_set_school_id
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_audit_log_school_id();

COMMIT;
