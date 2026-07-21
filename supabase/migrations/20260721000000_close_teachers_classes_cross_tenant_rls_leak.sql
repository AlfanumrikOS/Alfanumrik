-- Migration: 20260721000000_close_teachers_classes_cross_tenant_rls_leak.sql
-- Purpose: Close the cross-tenant PII read leak on public.teachers and
--          public.classes that migration 20260715110000 self-documented as
--          known-unfixed legacy debt (see that file's "Note (current legacy
--          read breadth)" comment, lines 32-38).
--
-- ---------------------------------------------------------------------------
-- WHAT LEAK THIS CLOSES (RCA finding, HIGH severity, P8/P13)
-- ---------------------------------------------------------------------------
-- "teachers_select_merged" (baseline_from_prod.sql:22438) predicate is
--   auth_user_id = auth.uid() OR auth.role() = 'authenticated'
-- The OR-branch means ANY signed-in user, of ANY school, can SELECT every
-- row of public.teachers (name, email, phone, employee_id) across every
-- tenant.
--
-- "Anyone can read active classes" (baseline_from_prod.sql:19807) predicate is
--   is_active = true OR deleted_at IS NULL
-- This has no `TO authenticated` restriction and is true for nearly every
-- row regardless of `is_active`, so it is an effectively unrestricted read
-- of every class (grade, section, subject, school_id) across every tenant,
-- to any role PostgREST grants SELECT to.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE TO TIGHTEN NOW (verified legitimate-read-path coverage)
-- ---------------------------------------------------------------------------
-- Every legitimate read path this migration removes is ALREADY covered by a
-- separate, correctly tenant-scoped policy, confirmed by reading the full
-- policy set on both tables before writing this migration:
--
-- classes (4 other SELECT policies already present, none touched here):
--   - "School admins can view school classes" (school_admins-lookup scoped)
--   - "School staff can view own school classes" (get_jwt_school_id() scoped,
--     added by 20260715110000)
--   - "Students can view their enrolled classes" (class_students join scoped
--     to auth.uid() via students.auth_user_id)
--   - "Teachers can view their classes" (class_teachers join scoped to
--     auth.uid() via teachers.auth_user_id)
--   => dropping "Anyone can read active classes" needs NO replacement policy.
--
-- teachers (2 other SELECT policies already present, none touched here):
--   - "School admins can view school teachers" (school_admins-lookup scoped)
--   - "School staff can view own school teachers" (get_jwt_school_id() scoped,
--     added by 20260715110000)
--   BUT there is no existing "a teacher can read their own row" policy other
--   than the one being dropped, so this migration ADDS
--   "teachers_select_own" (auth_user_id = auth.uid()) to preserve that one
--   legitimate path.
--
-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------
-- RLS stays ENABLED on both tables throughout. Idempotent via
-- DROP POLICY IF EXISTS. No table/column is dropped or altered. This
-- migration only narrows the two over-broad SELECT policies and adds back
-- the one legitimate self-read path on teachers that would otherwise be
-- lost; it does not touch INSERT/UPDATE/DELETE policies, the school-admin
-- policies, or the JWT-staff policies added by 20260715110000.

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

-- teachers: remove the cross-tenant leak, replace with an own-row-only policy.
DROP POLICY IF EXISTS "teachers_select_merged" ON public.teachers;

DROP POLICY IF EXISTS "teachers_select_own" ON public.teachers;
CREATE POLICY "teachers_select_own"
  ON public.teachers FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- classes: remove the cross-tenant leak. No replacement needed - admin,
-- JWT-staff, student-enrolled, and teacher-assigned reads are already
-- covered by the four pre-existing policies documented above.
DROP POLICY IF EXISTS "Anyone can read active classes" ON public.classes;
