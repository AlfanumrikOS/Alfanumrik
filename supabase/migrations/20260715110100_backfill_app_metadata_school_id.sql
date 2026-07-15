-- Migration: 20260715110100_backfill_app_metadata_school_id.sql
-- Purpose: Backfill auth.users.raw_app_meta_data->>'school_id' for EXISTING
--          single-school staff so the get_jwt_school_id() tenant-isolation
--          policies (students/teachers/classes) fire for them without waiting
--          for the setSchoolClaim helper to run on their next onboarding event.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY (Phase 4 security core)
-- ─────────────────────────────────────────────────────────────────────────────
-- Nothing has ever written app_metadata.school_id, so get_jwt_school_id()
-- (20260506000002) always returns NULL and the school-staff RLS policies never
-- fire. setSchoolClaim (packages/lib/src/identity/school-claim.ts) closes this
-- going forward; this migration closes it for the existing population.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CONSERVATIVE / IDEMPOTENT / REPLAYABLE
-- ─────────────────────────────────────────────────────────────────────────────
--  • MERGE, never clobber: `raw_app_meta_data || jsonb_build_object(...)` does a
--    shallow top-level merge, preserving provider/providers/role/etc. and only
--    adding school_id. COALESCE(...,'{}') guards a NULL metadata column (NULL || x
--    would wipe it).
--  • Only fills an ABSENT/NULL/empty claim
--    (NULLIF(raw_app_meta_data->>'school_id','') IS NULL). Never overwrites a
--    DIFFERENT existing school_id claim. Re-running is therefore a no-op once set.
--  • SINGLE-SCHOOL ONLY: each branch resolves to exactly one distinct school per
--    auth user (HAVING COUNT(DISTINCT school_id) = 1). Multi-school users are
--    skipped — a single scalar claim would be misleading (they stay on the
--    explicit school_admins-scoped query path via authorizeSchoolAdmin).
--  • ACTIVE only: is_active = true on the source row(s).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ STUDENTS ARE DELIBERATELY EXCLUDED (architect security decision)
-- ─────────────────────────────────────────────────────────────────────────────
-- The Phase 4 brief listed students (3c) for backfill, but backfilling the claim
-- onto STUDENT auth users is UNSAFE against the CURRENT schema and is NOT done
-- here. Reason: the students staff SELECT policy
--   ("School staff can view own school students", 20260506000002) is ROLE-AGNOSTIC:
--     USING ( auth_user_id = auth.uid()
--             OR (school_id IS NOT NULL AND school_id = get_jwt_school_id()) )
-- It grants read to ANY caller whose JWT school_id matches the row's school_id —
-- there is no staff check. If a STUDENT carried the claim, get_jwt_school_id()
-- would return their own school and the second branch would let that student
-- SELECT EVERY same-school student's row — name, email, phone, parent names,
-- emergency_contact. That is a P8 (tenant/peer isolation) + P13 (PII) regression.
-- Staff (school_admins/teachers) reading all same-school students IS the intended
-- behavior of that policy; students reading peers is NOT.
--
-- PREREQUISITE before any student backfill: add a staff guard to the students
-- staff branch (e.g. require the caller to be an active school_admins/teachers
-- member of that school), which is a change to the CORE tenant policy and needs
-- the full RBAC review chain (backend + frontend + ops + testing) — out of scope
-- for this focused phase. Until then, student self-reads already work via the
-- auth_user_id = auth.uid() branch, so students lose nothing by being excluded.

-- ─────────────────────────────────────────────────────────────────────────────
-- (a) school_admins who administer EXACTLY ONE school → claim that school.
-- ─────────────────────────────────────────────────────────────────────────────
WITH single_school_admins AS (
  SELECT sa.auth_user_id,
         MIN(sa.school_id::text) AS school_id  -- single value (guaranteed by HAVING)
  FROM public.school_admins sa
  WHERE sa.is_active = true
    AND sa.auth_user_id IS NOT NULL
    AND sa.school_id IS NOT NULL
  GROUP BY sa.auth_user_id
  HAVING COUNT(DISTINCT sa.school_id) = 1
)
UPDATE auth.users u
SET raw_app_meta_data =
      COALESCE(u.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('school_id', ssa.school_id)
FROM single_school_admins ssa
WHERE u.id = ssa.auth_user_id
  AND NULLIF(u.raw_app_meta_data ->> 'school_id', '') IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- (b) teachers with a non-null school_id, resolving to EXACTLY ONE school.
--     (A teacher is scalar-scoped to one school_id per row; the single-school
--      CTE also guards the rare case of duplicate teacher rows across schools,
--      avoiding an ambiguous UPDATE ... FROM join and any multi-school claim.)
-- ─────────────────────────────────────────────────────────────────────────────
WITH single_school_teachers AS (
  SELECT t.auth_user_id,
         MIN(t.school_id::text) AS school_id
  FROM public.teachers t
  WHERE t.is_active = true
    AND t.auth_user_id IS NOT NULL
    AND t.school_id IS NOT NULL
  GROUP BY t.auth_user_id
  HAVING COUNT(DISTINCT t.school_id) = 1
)
UPDATE auth.users u
SET raw_app_meta_data =
      COALESCE(u.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('school_id', sst.school_id)
FROM single_school_teachers sst
WHERE u.id = sst.auth_user_id
  AND NULLIF(u.raw_app_meta_data ->> 'school_id', '') IS NULL;

-- NOTE: like all app_metadata changes, these claims take effect on each user's
-- NEXT token refresh/login. The service-role read paths remain the safety net
-- until claims propagate — do not remove them in this phase.
