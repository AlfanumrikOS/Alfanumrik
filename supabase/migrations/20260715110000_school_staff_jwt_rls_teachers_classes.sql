-- Migration: 20260715110000_school_staff_jwt_rls_teachers_classes.sql
-- Purpose: Make JWT-claim tenant isolation real for school-staff reads of
--          teachers + classes by mirroring the existing students staff SELECT
--          policy onto teachers + classes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTEXT (Phase 4 security core)
-- ─────────────────────────────────────────────────────────────────────────────
-- public.get_jwt_school_id() (migration 20260506000002_white_label_school_schema.sql,
-- lines 29-40) reads auth.jwt() -> app_metadata ->> 'school_id'. Until Phase 4,
-- nothing wrote that claim, so it always returned NULL and the students staff
-- policy ("School staff can view own school students", same migration) never
-- fired. Phase 4 now writes the claim (setSchoolClaim helper +
-- backfill migration 20260715110100).
--
-- The students table already had a get_jwt_school_id()-based staff SELECT policy;
-- teachers and classes did NOT (they only had the school_admins-table-lookup
-- policies "School admins can view school teachers/classes", which cover admins
-- but not claim-scoped teachers). These two policies close that gap so a
-- correctly-claimed staff member can SELECT teachers/classes rows in THEIR OWN
-- school (school_id = get_jwt_school_id()).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIVE ONLY (P8)
-- ─────────────────────────────────────────────────────────────────────────────
-- RLS stays ENABLED on both tables. PostgreSQL combines PERMISSIVE policies with
-- OR, so these only BROADEN read access for correctly-claimed staff — they never
-- narrow, weaken, or replace any existing policy (the school_admins-lookup
-- policies, the self/authenticated policies, or the service_role policies all
-- remain in force and unchanged). Idempotent via DROP POLICY IF EXISTS.
--
-- Note (current legacy read breadth): teachers already has "teachers_select_merged"
-- (auth.role() = 'authenticated' — every signed-in user can read all teachers) and
-- classes already has "Anyone can read active classes". So on TODAY's policy set
-- these JWT policies do not expand who can read teachers/classes; their value is
-- (a) explicit, role-correct tenant scoping that stays correct once those broad
-- legacy policies are eventually tightened, and (b) parity with the students
-- staff policy. They are safe to add now.

-- Re-assert RLS (idempotent; already enabled in baseline — belt-and-suspenders for
-- fresh DBs: CI live-DB tests, new staging, DR).
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

-- Teachers: school staff can view teachers in their own (claimed) school.
DROP POLICY IF EXISTS "School staff can view own school teachers" ON public.teachers;
CREATE POLICY "School staff can view own school teachers"
  ON public.teachers FOR SELECT TO authenticated
  USING (
    school_id IS NOT NULL AND school_id = public.get_jwt_school_id()
  );

-- Classes: school staff can view classes in their own (claimed) school.
DROP POLICY IF EXISTS "School staff can view own school classes" ON public.classes;
CREATE POLICY "School staff can view own school classes"
  ON public.classes FOR SELECT TO authenticated
  USING (
    school_id IS NOT NULL AND school_id = public.get_jwt_school_id()
  );
