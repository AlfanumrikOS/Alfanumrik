-- Migration: 20260728090100_repair_vacuous_owner_scoped_policies.sql
-- Purpose: repair owner-scoped RLS policies whose NAME claims per-user scoping
--          but whose predicate is USING (true), and install an apply-time
--          detector for the production/repo policy drift described below.
--
-- Companion to 20260728090000_lockdown_anon_readable_public_tables.sql.
-- That migration closed anon (unauthenticated) reads. This one addresses the
-- SECOND audit finding: policies that exist in production but not in this repo,
-- so any environment rebuilt from the migration chain (CI live-DB tests, a new
-- staging project, disaster recovery) comes up with a weaker posture than prod.
--
-- ===========================================================================
-- WHAT WAS MEASURED, AND WHAT COULD NOT BE
-- ===========================================================================
-- MEASURED (by static replay of all 469 files in supabase/migrations/ in
-- filename order, applying every CREATE/DROP/ALTER POLICY):
--   * final modelled repo state: 721 policies across 351 tables,
--     RLS enabled on 388 tables
--   * policies whose name matches '_own': 110, across 91 tables
--   * of the 111 CREATE POLICY ..._own... statements in the repo,
--     104 live inside 00000000000000_baseline_from_prod.sql and only 7 in the
--     468 timestamped migrations
--
-- NOT MEASURED: the authoring environment had NO production database
-- credentials, so production's live pg_policies could not be read. The exact
-- production-vs-repo drift count is therefore UNVERIFIED here.
--
-- IMPORTANT CAVEAT ON THE AUDIT'S NUMBERS. The audit reported "604 _own_*
-- policies across 151 tables in production vs only 17 in supabase/migrations/".
-- The "17" does not reproduce: this repo contains 110 surviving _own policies
-- across 91 tables. Because 104 of the 111 _own CREATE statements are inside
-- the baseline dump and only 7 are in the timestamped files, the most likely
-- explanation is that the repo-side grep skipped
-- 00000000000000_baseline_from_prod.sql -- which is where ~94% of this repo's
-- policies (522 of 721 CREATE POLICY statements) actually live.
-- The drift is therefore real but very likely much SMALLER than 604 - 17.
-- Do not quote a drift number until the query below has been run against prod.
--
-- TO MEASURE THE DRIFT PROPERLY (run read-only against production, then diff
-- against the replayed repo state):
--   SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
--     FROM pg_policies WHERE schemaname = 'public'
--    ORDER BY tablename, policyname;
--
-- A faithful "capture every production policy into the repo" migration cannot
-- be authored without that output -- inventing CREATE POLICY statements from
-- guesses would reproduce exactly the failure mode this audit is about: a
-- guard that looks authoritative while asserting something unverified.
-- This migration therefore delivers the VERIFIED subset only, plus a detector
-- that makes the remaining drift fail loudly instead of silently.
--
-- STILL OUTSTANDING after this file (explicitly not covered):
--   * the full production policy set for the ~151 tables the audit counted
--   * any prod-only policy on a table not named below
--   Both require the pg_policies dump above.
--
-- ===========================================================================
-- THE VERIFIED REPAIR
-- ===========================================================================
-- Replaying the chain and testing every '_own'-named policy for a vacuous
-- predicate found exactly ONE genuine case (the other 13 name-matches are
-- INSERT policies, which legitimately carry no USING clause and were confirmed
-- to have real WITH CHECK predicates such as auth_user_id = auth.uid()):
--
--   public.chapter_study_sessions / "students_read_own_css"
--     FOR SELECT TO authenticated USING (true)
--
-- The name says "read own". The predicate says "read everyone". Any logged-in
-- user could read EVERY student's study sessions -- student_id, grade, subject,
-- chapter, lesson_plan, section_understanding, concepts_understood. That is a
-- cross-student boundary violation (P8) and learner-data exposure (P13).
--
-- The audit observed this table correctly owner-scoped in PRODUCTION only, via
-- a policy that exists nowhere in this repo. So production is currently fine
-- and the REPO is the defect: a rebuilt environment reintroduces the leak.
-- This migration makes the repo reproduce the safe posture.
--
-- SAFETY: zero client references to chapter_study_sessions exist anywhere in
-- apps/, packages/ or mobile/ (no .from('chapter_study_sessions') in web or
-- Flutter). All access is service_role, which bypasses RLS and is unaffected.
-- The table's only other policy, "service_role_full_access_css" (ALL TO
-- service_role), is left untouched.
--
-- Because permissive policies OR together, replacing a true-qual policy with an
-- owner-scoped one can only NARROW access; it cannot widen production even if
-- prod's own owner-scoped policy is still present under a different name.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. No table or column is
-- dropped. Safe to re-run.
-- ===========================================================================

ALTER TABLE "public"."chapter_study_sessions" ENABLE ROW LEVEL SECURITY;

-- Drop the vacuously-named policy (name claims "own", predicate says "all").
DROP POLICY IF EXISTS "students_read_own_css" ON "public"."chapter_study_sessions";
DROP POLICY IF EXISTS "chapter_study_sessions_owner_read" ON "public"."chapter_study_sessions";

-- Replace with a real owner-scoped predicate covering the four required
-- patterns: student reads own (get_my_student_ids); parent reads linked child
-- (is_guardian_of resolves guardian_student_links WHERE status = 'approved');
-- teacher reads assigned student (is_teacher_of resolves class_enrollments ->
-- classes); admin/service_role bypasses RLS entirely.
--
-- RS-RULE COMPLIANCE (XC-3 / TSB-4 recursion class). All three disjuncts
-- delegate to a SECURITY DEFINER helper; none inlines a FROM/JOIN over another
-- RLS-enabled table. An earlier revision of this file wrote the student-own
-- disjunct as
--     student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
-- which is precisely the 2026-07-02 TSB-4 defect: that subquery is SECURITY
-- INVOKER, so it re-enters public.students' OWN RLS and can close a
-- students -> ... -> students cycle ("infinite recursion detected in policy for
-- relation students"), deadlocking reads on BOTH chapter_study_sessions and
-- students. See 20260702080000_fix_students_rls_infinite_recursion.sql and
-- docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md (§5).
--
-- HELPER CHOICE: public.get_my_student_ids() (baseline_from_prod.sql:8989) is
-- SECURITY DEFINER STABLE with SET search_path = public and a body of exactly
--     SELECT id FROM students WHERE auth_user_id = auth.uid()
-- — the identical predicate, so this is a pure recursion-safety refactor with
-- ZERO semantic change. Deliberately NOT get_my_student_id() (singular), whose
-- extra `AND is_active = true` would silently narrow access. No new helper was
-- minted; both are already on the guard's helper roster (set H).
CREATE POLICY "chapter_study_sessions_owner_read" ON "public"."chapter_study_sessions"
  FOR SELECT TO "authenticated" USING (
    "student_id" IN (SELECT "public"."get_my_student_ids"())
    OR "public"."is_guardian_of"("student_id")
    OR "public"."is_teacher_of"("student_id")
  );

-- ---------------------------------------------------------------------------
-- APPLY-TIME DRIFT DETECTOR
-- ---------------------------------------------------------------------------
-- Surfaces two classes of silent weakness in whatever environment this is
-- applied to, including production. It only WARNS -- it never drops a policy it
-- was not explicitly told about -- so it is safe to run anywhere, and its
-- output is the worklist for the full drift capture described in the header.
--
--   (1) VACUOUS OWNER SCOPING: a policy whose name implies per-user scoping
--       ('own', 'self', 'mine') but whose USING predicate is literally true.
--       This is the class of defect repaired above.
--   (2) RLS ENABLED, ZERO POLICIES: a table advertised as protected that in
--       practice denies everyone except service_role. Usually intentional
--       (see bucket (d) of the companion migration) but occasionally an
--       accident, and worth seeing listed.
DO $$
DECLARE
  r         record;
  v_vacuous int := 0;
  v_norls   int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, roles
      FROM pg_policies
     WHERE schemaname = 'public'
       AND permissive = 'PERMISSIVE'
       AND cmd IN ('SELECT', 'ALL', 'UPDATE', 'DELETE')
       AND btrim(COALESCE(qual, '')) = 'true'
       AND policyname ~* '(own|self|mine)'
     ORDER BY tablename, policyname
  LOOP
    v_vacuous := v_vacuous + 1;
    RAISE WARNING 'VACUOUS OWNER-SCOPED POLICY: public.% / % (cmd=%, roles=%) is named as if per-user but its predicate is USING (true)',
                  r.tablename, r.policyname, r.cmd, r.roles;
  END LOOP;

  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
     ORDER BY c.relname
  LOOP
    v_norls := v_norls + 1;
    RAISE NOTICE 'RLS ENABLED BUT NO POLICIES (service_role-only): public.%', r.tablename;
  END LOOP;

  RAISE NOTICE 'policy-drift detector: % vacuous owner-scoped policy(ies), % table(s) RLS-enabled with no policies',
               v_vacuous, v_norls;

  IF v_vacuous > 0 THEN
    RAISE WARNING 'policy-drift detector found % vacuous owner-scoped policy(ies) beyond the one repaired by this migration -- capture pg_policies from this environment and extend the repair',
                  v_vacuous;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SELF-VERIFICATION
-- ---------------------------------------------------------------------------
-- Confirm this migration actually changed pg_policies rather than reporting
-- success while doing nothing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'chapter_study_sessions'
       AND policyname = 'students_read_own_css'
  ) THEN
    RAISE EXCEPTION 'repair failed: the vacuous policy students_read_own_css is still present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'chapter_study_sessions'
       AND policyname = 'chapter_study_sessions_owner_read'
       AND btrim(COALESCE(qual, '')) <> 'true'
  ) THEN
    RAISE EXCEPTION 'repair failed: chapter_study_sessions_owner_read is missing or still has a true predicate';
  END IF;

  RAISE NOTICE 'verified: chapter_study_sessions read policy is now owner-scoped with a non-trivial predicate';
END $$;
