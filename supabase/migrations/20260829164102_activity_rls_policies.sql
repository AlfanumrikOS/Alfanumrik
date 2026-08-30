-- Reconstructed from production ledger (supabase_migrations.schema_migrations).
-- Originally applied out-of-band 2026-08-29; committed to restore parity.
-- Content verified byte-identical to stored statements. Do not re-run
-- against production — already applied at version 20260829164102.

DROP POLICY IF EXISTS "quiz_sessions_admin_select" ON public.quiz_sessions;
CREATE POLICY "quiz_sessions_admin_select" ON public.quiz_sessions
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "quiz_responses_teacher_select" ON public.quiz_responses;
CREATE POLICY "quiz_responses_teacher_select" ON public.quiz_responses
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "quiz_responses_guardian_select" ON public.quiz_responses;
CREATE POLICY "quiz_responses_guardian_select" ON public.quiz_responses
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "quiz_responses_admin_select" ON public.quiz_responses;
CREATE POLICY "quiz_responses_admin_select" ON public.quiz_responses
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "foxy_sessions_teacher_select" ON public.foxy_sessions;
CREATE POLICY "foxy_sessions_teacher_select" ON public.foxy_sessions
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "foxy_sessions_guardian_select" ON public.foxy_sessions;
CREATE POLICY "foxy_sessions_guardian_select" ON public.foxy_sessions
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "foxy_sessions_admin_select" ON public.foxy_sessions;
CREATE POLICY "foxy_sessions_admin_select" ON public.foxy_sessions
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "foxy_chat_messages_teacher_select" ON public.foxy_chat_messages;
CREATE POLICY "foxy_chat_messages_teacher_select" ON public.foxy_chat_messages
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "foxy_chat_messages_guardian_select" ON public.foxy_chat_messages;
CREATE POLICY "foxy_chat_messages_guardian_select" ON public.foxy_chat_messages
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "foxy_chat_messages_admin_select" ON public.foxy_chat_messages;
CREATE POLICY "foxy_chat_messages_admin_select" ON public.foxy_chat_messages
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "concept_attempts_teacher_select" ON public.concept_attempts;
CREATE POLICY "concept_attempts_teacher_select" ON public.concept_attempts
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "concept_attempts_guardian_select" ON public.concept_attempts;
CREATE POLICY "concept_attempts_guardian_select" ON public.concept_attempts
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "concept_attempts_admin_select" ON public.concept_attempts;
CREATE POLICY "concept_attempts_admin_select" ON public.concept_attempts
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "xp_transactions_admin_select" ON public.xp_transactions;
CREATE POLICY "xp_transactions_admin_select" ON public.xp_transactions
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "xp_transactions_service_all" ON public.xp_transactions;
CREATE POLICY "xp_transactions_service_all" ON public.xp_transactions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "chapter_progress_admin_select" ON public.chapter_progress;
CREATE POLICY "chapter_progress_admin_select" ON public.chapter_progress
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "challenge_attempts_teacher_select" ON public.challenge_attempts;
CREATE POLICY "challenge_attempts_teacher_select" ON public.challenge_attempts
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "challenge_attempts_admin_select" ON public.challenge_attempts;
CREATE POLICY "challenge_attempts_admin_select" ON public.challenge_attempts
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "challenge_attempts_service_all" ON public.challenge_attempts;
CREATE POLICY "challenge_attempts_service_all" ON public.challenge_attempts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "sna_teacher_select" ON public.student_ncert_attempts;
CREATE POLICY "sna_teacher_select" ON public.student_ncert_attempts
  FOR SELECT TO authenticated
  USING (student_id IN (
    SELECT s.auth_user_id FROM public.students s
    WHERE public.is_teacher_of(s.id)
  ));

DROP POLICY IF EXISTS "sna_guardian_select" ON public.student_ncert_attempts;
CREATE POLICY "sna_guardian_select" ON public.student_ncert_attempts
  FOR SELECT TO authenticated
  USING (student_id IN (
    SELECT s.auth_user_id FROM public.students s
    WHERE public.is_guardian_of(s.id)
  ));

DROP POLICY IF EXISTS "sna_admin_select" ON public.student_ncert_attempts;
CREATE POLICY "sna_admin_select" ON public.student_ncert_attempts
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "mta_teacher_select" ON public.mock_test_attempts;
CREATE POLICY "mta_teacher_select" ON public.mock_test_attempts
  FOR SELECT TO authenticated
  USING (student_id IN (
    SELECT s.auth_user_id FROM public.students s
    WHERE public.is_teacher_of(s.id)
  ));

DROP POLICY IF EXISTS "mta_guardian_select" ON public.mock_test_attempts;
CREATE POLICY "mta_guardian_select" ON public.mock_test_attempts
  FOR SELECT TO authenticated
  USING (student_id IN (
    SELECT s.auth_user_id FROM public.students s
    WHERE public.is_guardian_of(s.id)
  ));

DROP POLICY IF EXISTS "mta_admin_select" ON public.mock_test_attempts;
CREATE POLICY "mta_admin_select" ON public.mock_test_attempts
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "mta_service_all" ON public.mock_test_attempts;
CREATE POLICY "mta_service_all" ON public.mock_test_attempts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "assignment_submissions_guardian_select" ON public.assignment_submissions;
CREATE POLICY "assignment_submissions_guardian_select" ON public.assignment_submissions
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "assignment_submissions_admin_select" ON public.assignment_submissions;
CREATE POLICY "assignment_submissions_admin_select" ON public.assignment_submissions
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "student_bookmarks_guardian_select" ON public.student_bookmarks;
CREATE POLICY "student_bookmarks_guardian_select" ON public.student_bookmarks
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "student_bookmarks_admin_select" ON public.student_bookmarks;
CREATE POLICY "student_bookmarks_admin_select" ON public.student_bookmarks
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "student_notes_guardian_select" ON public.student_notes;
CREATE POLICY "student_notes_guardian_select" ON public.student_notes
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "student_notes_admin_select" ON public.student_notes;
CREATE POLICY "student_notes_admin_select" ON public.student_notes
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "student_achievements_teacher_select" ON public.student_achievements;
CREATE POLICY "student_achievements_teacher_select" ON public.student_achievements
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "student_achievements_guardian_select" ON public.student_achievements;
CREATE POLICY "student_achievements_guardian_select" ON public.student_achievements
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "student_achievements_admin_select" ON public.student_achievements;
CREATE POLICY "student_achievements_admin_select" ON public.student_achievements
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "learning_events_teacher_select" ON public.learning_events;
CREATE POLICY "learning_events_teacher_select" ON public.learning_events
  FOR SELECT TO authenticated
  USING (student_id IN (
    SELECT s.auth_user_id FROM public.students s
    WHERE public.is_teacher_of(s.id)
  ));

DROP POLICY IF EXISTS "learning_events_guardian_select" ON public.learning_events;
CREATE POLICY "learning_events_guardian_select" ON public.learning_events
  FOR SELECT TO authenticated
  USING (student_id IN (
    SELECT s.auth_user_id FROM public.students s
    WHERE public.is_guardian_of(s.id)
  ));

DROP POLICY IF EXISTS "learning_events_admin_select" ON public.learning_events;
CREATE POLICY "learning_events_admin_select" ON public.learning_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "learning_events_service_all" ON public.learning_events;
CREATE POLICY "learning_events_service_all" ON public.learning_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ai_interaction_logs_teacher_select" ON public.ai_interaction_logs;
CREATE POLICY "ai_interaction_logs_teacher_select" ON public.ai_interaction_logs
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "ai_interaction_logs_guardian_select" ON public.ai_interaction_logs;
CREATE POLICY "ai_interaction_logs_guardian_select" ON public.ai_interaction_logs
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "ai_interaction_logs_admin_select" ON public.ai_interaction_logs;
CREATE POLICY "ai_interaction_logs_admin_select" ON public.ai_interaction_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "ai_interaction_logs_service_all" ON public.ai_interaction_logs;
CREATE POLICY "ai_interaction_logs_service_all" ON public.ai_interaction_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "analytics_events_teacher_select" ON public.analytics_events;
CREATE POLICY "analytics_events_teacher_select" ON public.analytics_events
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "analytics_events_guardian_select" ON public.analytics_events;
CREATE POLICY "analytics_events_guardian_select" ON public.analytics_events
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "analytics_events_admin_select" ON public.analytics_events;
CREATE POLICY "analytics_events_admin_select" ON public.analytics_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "analytics_events_service_all" ON public.analytics_events;
CREATE POLICY "analytics_events_service_all" ON public.analytics_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_events_student_select" ON public.product_events;
CREATE POLICY "product_events_student_select" ON public.product_events
  FOR SELECT TO authenticated
  USING (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "product_events_student_insert" ON public.product_events;
CREATE POLICY "product_events_student_insert" ON public.product_events
  FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "product_events_teacher_select" ON public.product_events;
CREATE POLICY "product_events_teacher_select" ON public.product_events
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "product_events_guardian_select" ON public.product_events;
CREATE POLICY "product_events_guardian_select" ON public.product_events
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "product_events_admin_select" ON public.product_events;
CREATE POLICY "product_events_admin_select" ON public.product_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "product_events_service_all" ON public.product_events;
CREATE POLICY "product_events_service_all" ON public.product_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE public.engagement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engagement_events_student_select" ON public.engagement_events;
CREATE POLICY "engagement_events_student_select" ON public.engagement_events
  FOR SELECT TO authenticated
  USING (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "engagement_events_student_insert" ON public.engagement_events;
CREATE POLICY "engagement_events_student_insert" ON public.engagement_events
  FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "engagement_events_teacher_select" ON public.engagement_events;
CREATE POLICY "engagement_events_teacher_select" ON public.engagement_events
  FOR SELECT TO authenticated
  USING (public.is_teacher_of(student_id));

DROP POLICY IF EXISTS "engagement_events_guardian_select" ON public.engagement_events;
CREATE POLICY "engagement_events_guardian_select" ON public.engagement_events
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "engagement_events_admin_select" ON public.engagement_events;
CREATE POLICY "engagement_events_admin_select" ON public.engagement_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "engagement_events_service_all" ON public.engagement_events;
CREATE POLICY "engagement_events_service_all" ON public.engagement_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);