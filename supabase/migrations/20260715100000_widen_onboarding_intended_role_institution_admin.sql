-- Migration: 20260715100000_widen_onboarding_intended_role_institution_admin.sql
-- Purpose: Add 'institution_admin' to the allowed onboarding_state.intended_role
--          values so a school-admin signup can advance through the SAME
--          onboarding_state state machine as student/teacher/parent.
--          (Phase 3a of the onboarding-hardening initiative — DB layer.)
--
-- WHY THIS FILE EXISTS
-- --------------------
-- institution_admin has been a structural onboarding exception. The CHECK
-- constraint on onboarding_state.intended_role
-- (00000000000000_baseline_from_prod.sql:12564) allowed only
-- student|teacher|parent, so bootstrap_user_profile() structurally COULD NOT
-- write an onboarding_state row for a school admin — any attempt would violate
-- the constraint. School admins were instead created out-of-band by the app-side
-- fail-soft helper packages/lib/src/identity/school-admin-bootstrap.ts, which
-- writes schools + school_admins but NEVER onboarding_state. This widens the
-- CHECK additively so the RPC (see the companion migration
-- 20260715100100_*) can drive institution_admin through the normal funnel.
--
-- SCOPE / SAFETY CONTRACT
-- -----------------------
--   - ADDITIVE: widens an IN-list. Every previously-valid value stays valid; the
--     old allowed set {student,teacher,parent} is a strict SUBSET of the new one,
--     so no existing onboarding_state row can violate the new constraint and
--     ADD CONSTRAINT re-validates with zero risk.
--   - IDEMPOTENT: DROP CONSTRAINT IF EXISTS then ADD CONSTRAINT. Replayable — on a
--     fully-applied DB it drops and re-adds the identical constraint; on a
--     partially-applied DB (dropped, not re-added) the DROP is a no-op and the ADD
--     completes. Migrations apply serially, so no add-while-exists race.
--   - NO new tables  -> P8 RLS N/A (no policy change; onboarding_state keeps its
--     existing baseline RLS posture).
--   - NO grade columns touched -> P5 (grades are TEXT strings) N/A.
--   - NO DROP TABLE / DROP COLUMN.
--
-- APPLICATION IS DEPLOY-TIME: applied via the schema-reproducibility model
-- (docs/runbooks/schema-reproducibility-fix.md). Not `supabase db push`-able
-- locally in this worktree.

ALTER TABLE public.onboarding_state
  DROP CONSTRAINT IF EXISTS onboarding_state_intended_role_check;

ALTER TABLE public.onboarding_state
  ADD CONSTRAINT onboarding_state_intended_role_check
  CHECK (intended_role IN ('student', 'teacher', 'parent', 'institution_admin'));

-- Verification (no data writes): confirm the widened constraint is in place.
-- Fail-soft WARNING only — never aborts the migration.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'onboarding_state'
     AND c.conname = 'onboarding_state_intended_role_check'
   LIMIT 1;

  IF v_def IS NULL THEN
    RAISE WARNING '[20260715100000] onboarding_state_intended_role_check missing after ADD CONSTRAINT';
  ELSIF position('institution_admin' IN v_def) = 0 THEN
    RAISE WARNING '[20260715100000] onboarding_state_intended_role_check does not include institution_admin — widening not applied';
  ELSE
    RAISE NOTICE '[20260715100000] onboarding_state.intended_role now permits institution_admin. COMPLETE.';
  END IF;
END $verify$;
