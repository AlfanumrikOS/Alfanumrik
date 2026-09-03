-- 20260904070000_p2_5_phase2f_merge_rls_policies_batch5.sql
--
-- P2-5 phase 2, batch 5 of Category B (2026-09-03 launch audit, CEO-approved
-- "full consolidation, small batches with tests" — follow-up to batch 1
-- (20260903180000), batch 2 (20260903190000), batch 3 (20260903200000), and
-- batch 4 (20260904060000), same methodology).
--
-- Scope: the last 3 SELECT-only groups in the 5-6 policy tier —
-- engagement_events, product_events (5 policies each), and classes
-- (6 policies, but see the dedup note below). This closes out the
-- multi-policy consolidation except `students` itself, which remains
-- deliberately deferred to standalone handling (its own dedicated
-- recursion-guard test section treats it as an apex/high-sensitivity case).
--
-- METHOD (unchanged from batches 1-4): every USING clause below was generated
-- by a script from the EXACT live pg_policies qual text pulled immediately
-- before writing this file — never hand-retyped. All 3 groups here are
-- SELECT-only, so every merge uses USING only (no WITH CHECK).
--
-- classes: a Category-A-style leftover found while pulling live data.
-- "School admins can view school classes" and "classes_school_admin_select"
-- are BYTE-IDENTICAL duplicate policies (dedup that Category A's earlier
-- pass should have caught but missed — likely created after that pass ran,
-- or simply not scanned). Both are DROPped here like every other policy in
-- this merge, but the duplicate clause is intentionally included only ONCE
-- in the merged USING — an OR'd repeat of an identical clause is a no-op,
-- and writing it twice would misrepresent a 5-distinct-path merge as a
-- 6-distinct-path one. classes therefore collapses 6 policies into 5
-- distinct clauses.
--
-- engagement_events / product_events: both tables grant "own record" access
-- through TWO different mechanisms simultaneously — an inline
-- `student_id = auth.uid() OR student_id IN (SELECT s.id FROM students ...)`
-- subquery (own_select) AND a separate `student_id = get_my_student_id()`
-- helper call (student_select). These may not be perfectly equivalent
-- (get_my_student_id()'s own internals aren't inspected here) and are
-- carried forward unchanged, matching the precedent already set for
-- assignment_submissions' guardian-access duplication and teachers' two
-- near-identical self-read policies in batch 4 — preserved verbatim, not
-- unilaterally deduplicated, since confirming true equivalence is a
-- separate review, not a hygiene merge.
--
-- Recursion-guard ledger: see the companion update to
-- apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts in this same
-- PR for the GRANDFATHERED_INLINE_POLICIES swap this batch requires.

-- -- public.classes (SELECT, authenticated): merge 6 policies (5 distinct clauses) --
-- (see header: "School admins can view school classes" and
-- "classes_school_admin_select" are byte-identical; only one clause kept)
DROP POLICY IF EXISTS "Guardians can view childrens classes" ON public.classes;
DROP POLICY IF EXISTS "School admins can view school classes" ON public.classes;
DROP POLICY IF EXISTS "School staff can view own school classes" ON public.classes;
DROP POLICY IF EXISTS "Students can view their enrolled classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers can view their classes" ON public.classes;
DROP POLICY IF EXISTS "classes_school_admin_select" ON public.classes;
CREATE POLICY "classes_select_merged" ON public.classes
  FOR SELECT TO authenticated
  USING (
  ((id IN ( SELECT cs.class_id
   FROM ((class_students cs
     JOIN guardian_student_links gsl ON ((gsl.student_id = cs.student_id)))
     JOIN guardians g ON ((g.id = gsl.guardian_id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.status = ANY (ARRAY['active'::text, 'approved'::text]))))))
  OR ((school_id IN ( SELECT sa.school_id
   FROM school_admins sa
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))))
  OR (((school_id IS NOT NULL) AND (school_id = get_jwt_school_id())))
  OR ((id IN ( SELECT cs.class_id
   FROM (class_students cs
     JOIN students s ON ((s.id = cs.student_id)))
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  OR ((id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- -- public.engagement_events (SELECT, authenticated): merge 5 policies (5 distinct clauses) --
DROP POLICY IF EXISTS "engagement_events_admin_select" ON public.engagement_events;
DROP POLICY IF EXISTS "engagement_events_guardian_select" ON public.engagement_events;
DROP POLICY IF EXISTS "engagement_events_own_select" ON public.engagement_events;
DROP POLICY IF EXISTS "engagement_events_student_select" ON public.engagement_events;
DROP POLICY IF EXISTS "engagement_events_teacher_select" ON public.engagement_events;
CREATE POLICY "engagement_events_select_merged" ON public.engagement_events
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((student_id = get_my_student_id()))
  OR (is_teacher_of(student_id))
  );

-- -- public.product_events (SELECT, authenticated): merge 5 policies (5 distinct clauses) --
DROP POLICY IF EXISTS "product_events_admin_select" ON public.product_events;
DROP POLICY IF EXISTS "product_events_guardian_select" ON public.product_events;
DROP POLICY IF EXISTS "product_events_own_select" ON public.product_events;
DROP POLICY IF EXISTS "product_events_student_select" ON public.product_events;
DROP POLICY IF EXISTS "product_events_teacher_select" ON public.product_events;
CREATE POLICY "product_events_select_merged" ON public.product_events
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((student_id = get_my_student_id()))
  OR (is_teacher_of(student_id))
  );
