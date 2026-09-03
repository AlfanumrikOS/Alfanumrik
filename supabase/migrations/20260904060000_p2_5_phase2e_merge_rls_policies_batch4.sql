-- 20260904060000_p2_5_phase2e_merge_rls_policies_batch4.sql
--
-- P2-5 phase 2, batch 4 of Category B (2026-09-03 launch audit, CEO-
-- approved "full consolidation, small batches with tests" — follow-up to
-- batch 1 (20260903180000), batch 2 (20260903190000), and batch 3
-- (20260903200000), same methodology).
--
-- Scope: 14 remaining 4-policy, same-role SELECT groups: ai_interaction_logs,
-- analytics_events, assignment_submissions, class_schedule, concept_attempts,
-- foxy_chat_messages, foxy_sessions, learning_events, mock_test_attempts,
-- quiz_responses, student_achievements, student_ncert_attempts, teachers, and
-- realtime.messages (a Supabase system-schema table, not `public`). Deliberately
-- excludes `students` itself (its own dedicated recursion-guard test section
-- treats it as an apex/high-sensitivity case; merging it deserves standalone
-- handling, not a routine batch) and the remaining 5-6-policy groups
-- (engagement_events SELECT, product_events SELECT, classes SELECT) —
-- tracked as later batches.
--
-- METHOD (unchanged from batches 1-3): every USING clause below was generated
-- by a script from the EXACT live pg_policies qual text pulled immediately
-- before writing this file — never hand-retyped. All 14 groups here are
-- SELECT-only, so every merge uses USING only (no WITH CHECK).
--
-- Two tables carry a same-role duplication worth calling out explicitly
-- (preserved verbatim, not unilaterally tightened — the "chapters" precedent
-- from batch 1 applies here):
--   - assignment_submissions grants guardian access through TWO different
--     mechanisms — the is_guardian_of(student_id) helper AND a separate
--     inline guardian_student_links/guardians subquery requiring
--     status = 'approved' specifically. These may not be perfectly
--     equivalent (is_guardian_of's own status criteria live inside the
--     helper, not inspected here) — both are carried forward unchanged.
--   - teachers has two policies that are logically identical modulo operand
--     order ("Teachers can view own record": auth.uid() = auth_user_id, vs.
--     teachers_select_own: auth_user_id = auth.uid()) — both carried forward
--     unchanged rather than deduplicating a near-miss for Category A (which
--     only drops byte-identical duplicates).
--
-- NAMING NOTE (teachers): the merged policy below is deliberately named
-- "teachers_scoped_select_merged", NOT "teachers_select_merged" (which would
-- otherwise match this batch's established <table>_select_merged
-- convention). A policy named exactly "teachers_select_merged" was a
-- documented HIGH-severity cross-tenant PII leak (REG-290, predicate
-- `auth_user_id = auth.uid() OR auth.role() = 'authenticated'` — any
-- signed-in user could read every teacher row) closed by migration
-- 20260721000400_close_teachers_classes_cross_tenant_rls_leak.sql. This
-- migration's merged predicate is unrelated and properly scoped (school-admin
-- lookup, JWT school-id match, or own-row match — no unconditional branch),
-- but reusing the exact retired name would be confusing for anyone auditing
-- migration history against that incident, so a distinct name was chosen
-- instead.
--
-- realtime.messages (SELECT): this is Supabase's own Realtime system table,
-- not an application table under `public`, gating WebSocket broadcast/
-- presence reads by message topic. Three of the four policies share the
-- identical `topic ~~ 'foxy:session:%'` prefix guard but differ in which
-- role's EXISTS check follows (guardian/member/teacher); the fourth guards a
-- disjoint `foxy:student:...` topic namespace. Each clause independently ANDs
-- its own topic-pattern guard with its own EXISTS check, so ORing them
-- together changes nothing about which topic succeeds for which role — same
-- self-contained-clause safety rationale already used for storage.objects in
-- batch 2.
--
-- Recursion-guard ledger: see the companion update to
-- apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts in this same
-- PR for the GRANDFATHERED_INLINE_POLICIES swap this batch requires — most
-- of these tables' "_own_*"-style policies inline the same `student_id IN
-- (SELECT s.id FROM students s WHERE s.auth_user_id = auth.uid())` (or the
-- auth.users.id-translation variant already documented for learning_events/
-- mock_test_attempts/student_ncert_attempts) cross-table pattern as batches
-- 1-3, so this batch is expected to trip the same "NEW/RENAMED inline
-- policy" detection for a pre-existing, not new, risk.

-- -- public.ai_interaction_logs (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "ai_interaction_logs_admin_select" ON public.ai_interaction_logs;
DROP POLICY IF EXISTS "ai_interaction_logs_guardian_select" ON public.ai_interaction_logs;
DROP POLICY IF EXISTS "ai_interaction_logs_own_select" ON public.ai_interaction_logs;
DROP POLICY IF EXISTS "ai_interaction_logs_teacher_select" ON public.ai_interaction_logs;
CREATE POLICY "ai_interaction_logs_select_merged" ON public.ai_interaction_logs
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.analytics_events (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "analytics_events_admin_select" ON public.analytics_events;
DROP POLICY IF EXISTS "analytics_events_guardian_select" ON public.analytics_events;
DROP POLICY IF EXISTS "analytics_events_own_select" ON public.analytics_events;
DROP POLICY IF EXISTS "analytics_events_teacher_select" ON public.analytics_events;
CREATE POLICY "analytics_events_select_merged" ON public.analytics_events
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.assignment_submissions (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "assignment_submissions_admin_select" ON public.assignment_submissions;
DROP POLICY IF EXISTS "assignment_submissions_guardian_select" ON public.assignment_submissions;
DROP POLICY IF EXISTS "assignment_submissions_own_select" ON public.assignment_submissions;
DROP POLICY IF EXISTS "assignment_submissions_parent_select" ON public.assignment_submissions;
CREATE POLICY "assignment_submissions_select_merged" ON public.assignment_submissions
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((student_id IN ( SELECT gsl.student_id
   FROM (guardian_student_links gsl
     JOIN guardians g ON ((g.id = gsl.guardian_id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.status = 'approved'::text)))))
  );

-- -- public.class_schedule (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "class_schedule_parent_select" ON public.class_schedule;
DROP POLICY IF EXISTS "class_schedule_school_admin_select" ON public.class_schedule;
DROP POLICY IF EXISTS "class_schedule_student_select" ON public.class_schedule;
DROP POLICY IF EXISTS "class_schedule_teacher_select" ON public.class_schedule;
CREATE POLICY "class_schedule_select_merged" ON public.class_schedule
  FOR SELECT TO authenticated
  USING (
  ((class_id IN ( SELECT cs.class_id
   FROM ((class_students cs
     JOIN guardian_student_links gsl ON ((gsl.student_id = cs.student_id)))
     JOIN guardians g ON ((g.id = gsl.guardian_id)))
  WHERE ((g.auth_user_id = ( SELECT auth.uid() AS uid)) AND (gsl.status = 'approved'::text)))))
  OR ((class_id IN ( SELECT c.id
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

-- -- public.concept_attempts (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "concept_attempts_admin_select" ON public.concept_attempts;
DROP POLICY IF EXISTS "concept_attempts_guardian_select" ON public.concept_attempts;
DROP POLICY IF EXISTS "concept_attempts_own_select" ON public.concept_attempts;
DROP POLICY IF EXISTS "concept_attempts_teacher_select" ON public.concept_attempts;
CREATE POLICY "concept_attempts_select_merged" ON public.concept_attempts
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.foxy_chat_messages (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "foxy_chat_messages_admin_select" ON public.foxy_chat_messages;
DROP POLICY IF EXISTS "foxy_chat_messages_guardian_select" ON public.foxy_chat_messages;
DROP POLICY IF EXISTS "foxy_chat_messages_own_select" ON public.foxy_chat_messages;
DROP POLICY IF EXISTS "foxy_chat_messages_teacher_select" ON public.foxy_chat_messages;
CREATE POLICY "foxy_chat_messages_select_merged" ON public.foxy_chat_messages
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.foxy_sessions (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "foxy_sessions_admin_select" ON public.foxy_sessions;
DROP POLICY IF EXISTS "foxy_sessions_guardian_select" ON public.foxy_sessions;
DROP POLICY IF EXISTS "foxy_sessions_own_select" ON public.foxy_sessions;
DROP POLICY IF EXISTS "foxy_sessions_teacher_select" ON public.foxy_sessions;
CREATE POLICY "foxy_sessions_select_merged" ON public.foxy_sessions
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.learning_events (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "learning_events_admin_select" ON public.learning_events;
DROP POLICY IF EXISTS "learning_events_guardian_select" ON public.learning_events;
DROP POLICY IF EXISTS "learning_events_own_select" ON public.learning_events;
DROP POLICY IF EXISTS "learning_events_teacher_select" ON public.learning_events;
CREATE POLICY "learning_events_select_merged" ON public.learning_events
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR ((student_id IN ( SELECT s.auth_user_id
   FROM students s
  WHERE is_guardian_of(s.id))))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((student_id IN ( SELECT s.auth_user_id
   FROM students s
  WHERE is_teacher_of(s.id))))
  );

-- -- public.mock_test_attempts (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "mta_admin_select" ON public.mock_test_attempts;
DROP POLICY IF EXISTS "mta_guardian_select" ON public.mock_test_attempts;
DROP POLICY IF EXISTS "mock_test_attempts_own_select" ON public.mock_test_attempts;
DROP POLICY IF EXISTS "mta_teacher_select" ON public.mock_test_attempts;
CREATE POLICY "mock_test_attempts_select_merged" ON public.mock_test_attempts
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR ((student_id IN ( SELECT s.auth_user_id
   FROM students s
  WHERE is_guardian_of(s.id))))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((student_id IN ( SELECT s.auth_user_id
   FROM students s
  WHERE is_teacher_of(s.id))))
  );

-- -- public.quiz_responses (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "quiz_responses_admin_select" ON public.quiz_responses;
DROP POLICY IF EXISTS "quiz_responses_guardian_select" ON public.quiz_responses;
DROP POLICY IF EXISTS "quiz_responses_own_select" ON public.quiz_responses;
DROP POLICY IF EXISTS "quiz_responses_teacher_select" ON public.quiz_responses;
CREATE POLICY "quiz_responses_select_merged" ON public.quiz_responses
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.student_achievements (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "student_achievements_admin_select" ON public.student_achievements;
DROP POLICY IF EXISTS "student_achievements_guardian_select" ON public.student_achievements;
DROP POLICY IF EXISTS "student_achievements_own_select" ON public.student_achievements;
DROP POLICY IF EXISTS "student_achievements_teacher_select" ON public.student_achievements;
CREATE POLICY "student_achievements_select_merged" ON public.student_achievements
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR (is_guardian_of(student_id))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR (is_teacher_of(student_id))
  );

-- -- public.student_ncert_attempts (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "sna_admin_select" ON public.student_ncert_attempts;
DROP POLICY IF EXISTS "sna_guardian_select" ON public.student_ncert_attempts;
DROP POLICY IF EXISTS "student_ncert_attempts_own_select" ON public.student_ncert_attempts;
DROP POLICY IF EXISTS "sna_teacher_select" ON public.student_ncert_attempts;
CREATE POLICY "student_ncert_attempts_select_merged" ON public.student_ncert_attempts
  FOR SELECT TO authenticated
  USING (
  (is_admin())
  OR ((student_id IN ( SELECT s.auth_user_id
   FROM students s
  WHERE is_guardian_of(s.id))))
  OR (((student_id = ( SELECT auth.uid() AS uid)) OR (student_id IN ( SELECT s.id
   FROM students s
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))))
  OR ((student_id IN ( SELECT s.auth_user_id
   FROM students s
  WHERE is_teacher_of(s.id))))
  );

-- -- public.teachers (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "School admins can view school teachers" ON public.teachers;
DROP POLICY IF EXISTS "School staff can view own school teachers" ON public.teachers;
DROP POLICY IF EXISTS "Teachers can view own record" ON public.teachers;
DROP POLICY IF EXISTS "teachers_select_own" ON public.teachers;
CREATE POLICY "teachers_scoped_select_merged" ON public.teachers
  FOR SELECT TO authenticated
  USING (
  ((school_id IN ( SELECT sa.school_id
   FROM school_admins sa
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))))
  OR (((school_id IS NOT NULL) AND (school_id = get_jwt_school_id())))
  OR ((( SELECT auth.uid() AS uid) = auth_user_id))
  OR ((auth_user_id = ( SELECT auth.uid() AS uid)))
  );

-- -- realtime.messages (SELECT, authenticated): merge 4 policies --
DROP POLICY IF EXISTS "foxy_session_guardians_can_receive" ON realtime.messages;
DROP POLICY IF EXISTS "foxy_session_members_can_receive" ON realtime.messages;
DROP POLICY IF EXISTS "foxy_session_teachers_can_receive" ON realtime.messages;
DROP POLICY IF EXISTS "foxy_student_realtime_read" ON realtime.messages;
CREATE POLICY "messages_select_merged" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
  (((topic ~~ 'foxy:session:%'::text) AND (split_part(topic, ':'::text, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (EXISTS ( SELECT 1
   FROM ((foxy_sessions fs
     JOIN students s ON ((s.id = fs.student_id)))
     JOIN guardians g ON ((g.auth_user_id = ( SELECT auth.uid() AS uid))))
  WHERE ((fs.id = (split_part(messages.topic, ':'::text, 3))::uuid) AND (EXISTS ( SELECT 1
           FROM guardian_student_links gsl
          WHERE ((gsl.student_id = s.id) AND (gsl.guardian_id = g.id) AND (COALESCE(gsl.status, 'pending'::text) = ANY (ARRAY['active'::text, 'approved'::text])) AND (gsl.revoked_at IS NULL)))))))))
  OR (((topic ~~ 'foxy:session:%'::text) AND (split_part(topic, ':'::text, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (EXISTS ( SELECT 1
   FROM (foxy_sessions fs
     JOIN students st ON ((st.id = fs.student_id)))
  WHERE ((fs.id = (split_part(messages.topic, ':'::text, 3))::uuid) AND (st.auth_user_id = ( SELECT auth.uid() AS uid)))))))
  OR (((topic ~~ 'foxy:session:%'::text) AND (split_part(topic, ':'::text, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (EXISTS ( SELECT 1
   FROM ((foxy_sessions fs
     JOIN students s ON ((s.id = fs.student_id)))
     JOIN teachers t ON ((t.auth_user_id = ( SELECT auth.uid() AS uid))))
  WHERE ((fs.id = (split_part(messages.topic, ':'::text, 3))::uuid) AND ((EXISTS ( SELECT 1
           FROM teacher_student_links tsl
          WHERE ((tsl.teacher_id = t.id) AND (tsl.student_id = s.id) AND (COALESCE(tsl.status, 'active'::text) = 'active'::text)))) OR (EXISTS ( SELECT 1
           FROM (class_students cs
             JOIN class_teachers ct ON ((ct.class_id = cs.class_id)))
          WHERE ((cs.student_id = s.id) AND (ct.teacher_id = t.id) AND COALESCE(cs.is_active, true) AND COALESCE(ct.is_active, true))))))))))
  OR (((topic ~ '^foxy:student:[0-9a-fA-F-]{36}$'::text) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.auth_user_id = ( SELECT auth.uid() AS uid)) AND (s.id = (split_part(messages.topic, ':'::text, 3))::uuid))))))
  );
