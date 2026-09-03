-- 20260903200000_p2_5_phase2d_merge_rls_policies_batch3.sql
--
-- P2-5 phase 2, batch 3 of Category B (2026-09-03 launch audit, CEO-
-- approved "full consolidation, small batches with tests" — follow-up to
-- batch 1 (20260903180000) and batch 2 (20260903190000), same methodology).
--
-- Scope: 12 remaining 3-policy, same-role SELECT groups: adaptive_interventions,
-- assignments, board_score_predictions, challenge_attempts, foxy_decision_log,
-- foxy_events, foxy_student_state, learner_twin_memory, learner_twin_snapshots,
-- student_attendance, student_bookmarks, student_notes. Deliberately excludes
-- `students` itself (its own dedicated recursion-guard test section treats it
-- as an apex/high-sensitivity case; merging it deserves standalone handling,
-- not a routine batch) and the remaining 4-6-policy groups — tracked as later
-- batches.
--
-- METHOD (unchanged from batches 1-2): every USING clause below was generated
-- by a script from the EXACT live pg_policies qual text pulled immediately
-- before writing this file — never hand-retyped. All 12 groups here are
-- SELECT-only, so every merge uses USING only (no WITH CHECK).
--
-- Also unchanged: only merged groups sharing the identical `roles` value.
-- challenge_attempts has a 4th live SELECT policy, challenge_attempts_parent_select,
-- with roles `{public}` (is_guardian_of(student_id)) — deliberately left
-- unmerged and untouched here, matching the same role-heterogeneity exclusion
-- already applied to students_select_merged (batch predecessor), xp_txn_parent_select,
-- and teacher_parent_messages in batch 2. A `{public}` policy applies to every
-- role including authenticated, so folding it into an authenticated-only merge
-- would either silently drop anon/other access or widen the other policies'
-- intended scope — a real semantic question, not a hygiene merge.
--
-- Recursion-guard ledger: see the companion update to
-- apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts in this same
-- PR for the GRANDFATHERED_INLINE_POLICIES swap this batch requires — several
-- of these tables' "_own_*"/"_student_*"-style policies inline the same
-- `student_id IN (SELECT s.id FROM students s WHERE s.auth_user_id =
-- auth.uid())` (or equivalent EXISTS-over-students) cross-table pattern as
-- batches 1-2, so this batch is expected to trip the same "NEW/RENAMED inline
-- policy" detection for a pre-existing, not new, risk.

-- -- public.adaptive_interventions (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "adaptive_interventions_own_select" ON public.adaptive_interventions;
DROP POLICY IF EXISTS "adaptive_interventions_parent_select" ON public.adaptive_interventions;
DROP POLICY IF EXISTS "adaptive_interventions_teacher_select" ON public.adaptive_interventions;
CREATE POLICY "adaptive_interventions_select_merged" ON public.adaptive_interventions
  FOR SELECT TO authenticated
  USING (
  (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_guardian_of(student_id))
  OR (is_teacher_of(student_id))
  );

-- -- public.assignments (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "School admins can view school assignments" ON public.assignments;
DROP POLICY IF EXISTS "Students can view class assignments" ON public.assignments;
DROP POLICY IF EXISTS "assignments_teacher_class_teachers_select" ON public.assignments;
CREATE POLICY "assignments_select_merged" ON public.assignments
  FOR SELECT TO authenticated
  USING (
  ((class_id IN ( SELECT c.id
   FROM (classes c
     JOIN school_admins sa ON ((sa.school_id = c.school_id)))
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))))
  OR ((class_id IN ( SELECT cs.class_id
   FROM (class_students cs
     JOIN students s ON ((s.id = cs.student_id)))
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  OR ((class_id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- -- public.board_score_predictions (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "board_score_predictions_admin_select" ON public.board_score_predictions;
DROP POLICY IF EXISTS "board_score_predictions_guardian_select" ON public.board_score_predictions;
DROP POLICY IF EXISTS "board_score_predictions_student_select" ON public.board_score_predictions;
CREATE POLICY "board_score_predictions_select_merged" ON public.board_score_predictions
  FOR SELECT TO authenticated
  USING (
  ((EXISTS ( SELECT 1
   FROM (user_roles ur
     JOIN roles r ON ((r.id = ur.role_id)))
  WHERE ((ur.auth_user_id = ( SELECT auth.uid() AS uid)) AND (ur.is_active = true) AND ((ur.expires_at IS NULL) OR (ur.expires_at > now())) AND (r.name = ANY (ARRAY['super_admin'::text, 'admin'::text]))))))
  OR ((EXISTS ( SELECT 1
   FROM (guardian_student_links gsl
     JOIN guardians g ON ((g.id = gsl.guardian_id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.student_id = board_score_predictions.student_id) AND (gsl.status = 'approved'::text)))))
  OR ((student_id = ( SELECT s.id
   FROM students s
  WHERE ((s.auth_user_id = ( SELECT auth.uid() AS uid)) AND (s.is_active = true))
 LIMIT 1)))
  );

-- -- public.challenge_attempts (SELECT, authenticated): merge 3 policies --
-- (challenge_attempts_parent_select, roles {public}, is deliberately excluded — see header)
DROP POLICY IF EXISTS "challenge_attempts_admin_select" ON public.challenge_attempts;
DROP POLICY IF EXISTS "challenge_attempts_own_select" ON public.challenge_attempts;
DROP POLICY IF EXISTS "challenge_attempts_teacher_select" ON public.challenge_attempts;
CREATE POLICY "challenge_attempts_select_merged" ON public.challenge_attempts
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.foxy_decision_log (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "foxy_decision_log_guardian_select" ON public.foxy_decision_log;
DROP POLICY IF EXISTS "foxy_decision_log_student_select" ON public.foxy_decision_log;
DROP POLICY IF EXISTS "foxy_decision_log_teacher_select" ON public.foxy_decision_log;
CREATE POLICY "foxy_decision_log_select_merged" ON public.foxy_decision_log
  FOR SELECT TO authenticated
  USING (
  ((EXISTS ( SELECT 1
   FROM (guardians g
     JOIN guardian_student_links gsl ON ((gsl.guardian_id = g.id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.student_id = foxy_decision_log.student_id) AND (COALESCE(gsl.status, 'pending'::text) = ANY (ARRAY['active'::text, 'approved'::text])) AND (gsl.revoked_at IS NULL)))))
  OR ((EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = foxy_decision_log.student_id) AND (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1
           FROM teacher_student_links tsl
          WHERE ((tsl.teacher_id = t.id) AND (tsl.student_id = foxy_decision_log.student_id) AND (COALESCE(tsl.status, 'active'::text) = 'active'::text)))) OR (EXISTS ( SELECT 1
           FROM (class_students cs
             JOIN class_teachers ct ON ((ct.class_id = cs.class_id)))
          WHERE ((cs.student_id = foxy_decision_log.student_id) AND (ct.teacher_id = t.id) AND COALESCE(cs.is_active, true) AND COALESCE(ct.is_active, true)))))))))
  );

-- -- public.foxy_events (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "foxy_events_guardian_select" ON public.foxy_events;
DROP POLICY IF EXISTS "foxy_events_student_select" ON public.foxy_events;
DROP POLICY IF EXISTS "foxy_events_teacher_select" ON public.foxy_events;
CREATE POLICY "foxy_events_select_merged" ON public.foxy_events
  FOR SELECT TO authenticated
  USING (
  ((EXISTS ( SELECT 1
   FROM (guardians g
     JOIN guardian_student_links gsl ON ((gsl.guardian_id = g.id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.student_id = foxy_events.student_id) AND (COALESCE(gsl.status, 'pending'::text) = ANY (ARRAY['active'::text, 'approved'::text])) AND (gsl.revoked_at IS NULL)))))
  OR ((EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = foxy_events.student_id) AND (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1
           FROM teacher_student_links tsl
          WHERE ((tsl.teacher_id = t.id) AND (tsl.student_id = foxy_events.student_id) AND (COALESCE(tsl.status, 'active'::text) = 'active'::text)))) OR (EXISTS ( SELECT 1
           FROM (class_students cs
             JOIN class_teachers ct ON ((ct.class_id = cs.class_id)))
          WHERE ((cs.student_id = foxy_events.student_id) AND (ct.teacher_id = t.id) AND COALESCE(cs.is_active, true) AND COALESCE(ct.is_active, true)))))))))
  );

-- -- public.foxy_student_state (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "foxy_student_state_guardian_select" ON public.foxy_student_state;
DROP POLICY IF EXISTS "foxy_student_state_student_select" ON public.foxy_student_state;
DROP POLICY IF EXISTS "foxy_student_state_teacher_select" ON public.foxy_student_state;
CREATE POLICY "foxy_student_state_select_merged" ON public.foxy_student_state
  FOR SELECT TO authenticated
  USING (
  ((EXISTS ( SELECT 1
   FROM (guardians g
     JOIN guardian_student_links gsl ON ((gsl.guardian_id = g.id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.student_id = foxy_student_state.student_id) AND (COALESCE(gsl.status, 'pending'::text) = ANY (ARRAY['active'::text, 'approved'::text])) AND (gsl.revoked_at IS NULL)))))
  OR ((EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = foxy_student_state.student_id) AND (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1
           FROM teacher_student_links tsl
          WHERE ((tsl.teacher_id = t.id) AND (tsl.student_id = foxy_student_state.student_id) AND (COALESCE(tsl.status, 'active'::text) = 'active'::text)))) OR (EXISTS ( SELECT 1
           FROM (class_students cs
             JOIN class_teachers ct ON ((ct.class_id = cs.class_id)))
          WHERE ((cs.student_id = foxy_student_state.student_id) AND (ct.teacher_id = t.id) AND COALESCE(cs.is_active, true) AND COALESCE(ct.is_active, true)))))))))
  );

-- -- public.learner_twin_memory (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "learner_twin_memory_parent_select" ON public.learner_twin_memory;
DROP POLICY IF EXISTS "learner_twin_memory_student_select" ON public.learner_twin_memory;
DROP POLICY IF EXISTS "learner_twin_memory_teacher_select" ON public.learner_twin_memory;
CREATE POLICY "learner_twin_memory_select_merged" ON public.learner_twin_memory
  FOR SELECT TO authenticated
  USING (
  (is_guardian_of(student_id))
  OR ((student_id = get_my_student_id()))
  OR (is_teacher_of(student_id))
  );

-- -- public.learner_twin_snapshots (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "learner_twin_snapshots_parent_select" ON public.learner_twin_snapshots;
DROP POLICY IF EXISTS "learner_twin_snapshots_student_select" ON public.learner_twin_snapshots;
DROP POLICY IF EXISTS "learner_twin_snapshots_teacher_select" ON public.learner_twin_snapshots;
CREATE POLICY "learner_twin_snapshots_select_merged" ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING (
  (is_guardian_of(student_id))
  OR ((student_id = get_my_student_id()))
  OR (is_teacher_of(student_id))
  );

-- -- public.student_attendance (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "student_attendance_parent_select" ON public.student_attendance;
DROP POLICY IF EXISTS "student_attendance_student_select" ON public.student_attendance;
DROP POLICY IF EXISTS "student_attendance_teacher_select" ON public.student_attendance;
CREATE POLICY "student_attendance_select_merged" ON public.student_attendance
  FOR SELECT TO authenticated
  USING (
  ((student_id IN ( SELECT gsl.student_id
   FROM (guardian_student_links gsl
     JOIN guardians g ON ((g.id = gsl.guardian_id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.status = 'approved'::text)))))
  OR ((student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  OR ((class_id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );

-- -- public.student_bookmarks (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "student_bookmarks_admin_select" ON public.student_bookmarks;
DROP POLICY IF EXISTS "student_bookmarks_guardian_select" ON public.student_bookmarks;
DROP POLICY IF EXISTS "student_bookmarks_own_select" ON public.student_bookmarks;
CREATE POLICY "student_bookmarks_select_merged" ON public.student_bookmarks
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  );

-- -- public.student_notes (SELECT, authenticated): merge 3 policies --
DROP POLICY IF EXISTS "student_notes_admin_select" ON public.student_notes;
DROP POLICY IF EXISTS "student_notes_guardian_select" ON public.student_notes;
DROP POLICY IF EXISTS "student_notes_own_select" ON public.student_notes;
CREATE POLICY "student_notes_select_merged" ON public.student_notes
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  );
