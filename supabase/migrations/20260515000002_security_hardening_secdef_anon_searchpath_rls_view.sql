-- Migration: security_hardening_secdef_anon_searchpath_rls_view
-- Date: 2026-05-15
-- Purpose: Address Supabase security advisor findings (priority block):
--   (1) security_definer_view on public.subscriber_lag           — fix
--   (2) function_search_path_mutable (2 triggers)                — fix
--   (3) rls_policy_always_true on 6 tables (audit/RAG/moments/   — fix
--       waitlist) — currently allow any caller to write anything
--   (4) anon-executable SECURITY DEFINER functions (60)          — revoke EXECUTE
--
-- Risk + rollback:
--   - Revoking anon EXECUTE on 60 SECDEF functions is the safer default
--     (these are state-changing or per-user reads). If a public landing/
--     marketing surface depends on get_leaderboard / get_hall_of_fame /
--     get_competition_leaderboard / get_chapter_rag_content /
--     get_ncert_coverage_report / get_board_exam_questions /
--     get_quiz_questions, those calls will start failing for unauthenticated
--     viewers. Re-grant per fn with `GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO anon;`.
--   - All policy rewrites use DROP POLICY IF EXISTS + CREATE, so re-running
--     is idempotent.
--   - View change is reversible via `ALTER VIEW … RESET (security_invoker);`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. security_definer_view: public.subscriber_lag
-- ─────────────────────────────────────────────────────────────────────────────
-- Switch from creator-rights (default in older PG) to caller-rights so the
-- view enforces the querier's RLS on state_events / subscriber_offsets /
-- subscriber_retry_state. The view body is unchanged.
DO $migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'subscriber_lag' AND n.nspname = 'public' AND c.relkind = 'v'
  ) THEN
    ALTER VIEW public.subscriber_lag SET (security_invoker = on);
    RAISE NOTICE 'subscriber_lag: security_invoker set';
  ELSE
    RAISE NOTICE 'subscriber_lag: view not present yet (created by later migration 20260524110001); skipping ALTER VIEW';
  END IF;
END
$migration_guard$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. function_search_path_mutable
-- ─────────────────────────────────────────────────────────────────────────────
-- Lock search_path so a session-level `SET search_path = ...` can't redirect
-- references to malicious objects. Matches the pattern set by
-- 20260408000003_fix_search_path_on_secdef_functions.sql.
DO $migration_guard_fns$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'notify_state_event' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.notify_state_event() SET search_path = pg_catalog, public;
    RAISE NOTICE 'notify_state_event: search_path locked';
  ELSE
    RAISE NOTICE 'notify_state_event: function not yet exists (created by later migration 20260517100000); skipping';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'tg_learner_mastery_touch' AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.tg_learner_mastery_touch() SET search_path = pg_catalog, public;
    RAISE NOTICE 'tg_learner_mastery_touch: search_path locked';
  ELSE
    RAISE NOTICE 'tg_learner_mastery_touch: function not yet exists (created by later migration); skipping';
  END IF;
END
$migration_guard_fns$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. rls_policy_always_true — replace permissive policies with real predicates
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. audit_logs.audit_logs_insert: was WITH CHECK (true) for authenticated.
--     Any signed-in user could write any audit row. Constrain to own user.
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = (select auth.uid()));

-- 3b. rag_content_audit, rag_query_logs, rag_retrieval_logs: server-side
--     observability tables. Drop the always-true public read/write policies;
--     service_role bypasses RLS and is the only legitimate writer/reader.
DROP POLICY IF EXISTS rag_audit_write ON public.rag_content_audit;
DROP POLICY IF EXISTS rag_audit_read  ON public.rag_content_audit;

DROP POLICY IF EXISTS rag_query_write ON public.rag_query_logs;
DROP POLICY IF EXISTS rag_query_read  ON public.rag_query_logs;

DROP POLICY IF EXISTS rag_retrieval_write ON public.rag_retrieval_logs;

-- 3c. student_moments.moments_insert: was WITH CHECK (true). Constrain so a
--     student can only insert moments tied to their own student_id (resolved
--     via the existing get_my_student_id() SECDEF helper).
DROP POLICY IF EXISTS moments_insert ON public.student_moments;
CREATE POLICY moments_insert
  ON public.student_moments FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

-- 3d. waitlist.waitlist_public_insert: keep anon-writable (signup form) but
--     require a non-empty email that at least passes a trivial shape check.
--     Read remains denied (waitlist_no_public_read is USING (false)).
DROP POLICY IF EXISTS waitlist_public_insert ON public.waitlist;
CREATE POLICY waitlist_public_insert
  ON public.waitlist FOR INSERT TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND length(btrim(email)) BETWEEN 3 AND 320
    AND email LIKE '%@%.%'
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Revoke EXECUTE FROM anon on SECURITY DEFINER functions
-- ─────────────────────────────────────────────────────────────────────────────
-- Default-deny posture: anonymous callers should never invoke privileged
-- (definer-rights) code. Re-grant per-fn if a public surface legitimately
-- needs one (e.g. logged-out leaderboard preview).
-- 60 entries (one per overload) — generated from pg_proc where prosecdef=true
-- and has_function_privilege('anon', oid, 'EXECUTE') = true at 2026-05-15.

REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(p_student_id uuid, p_subject text, p_xp integer, p_total integer, p_correct integer, p_time_seconds integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(p_student_id uuid, p_subject text, p_xp integer, p_total integer, p_correct integer, p_time_seconds integer, p_session_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(p_student_id uuid, p_xp integer, p_correct integer, p_total integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(p_student_id uuid, p_xp integer, p_correct integer, p_total integer, p_subject text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.available_chapters_for_student_subject_v2(p_student_id uuid, p_subject_code text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bootstrap_user_profile(p_auth_user_id uuid, p_role text, p_name text, p_email text, p_grade text, p_board text, p_school_name text, p_subjects_taught text[], p_grades_taught text[], p_phone text, p_link_code text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_and_record_usage(p_student_id uuid, p_feature text, p_usage_date date, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_experiment(p_simulation_id text, p_subject text, p_grade text, p_observation_type text, p_observation_text text, p_structured jsonb, p_data_entries jsonb, p_conclusion text, p_quiz_score integer, p_total_questions integer, p_time_spent_seconds integer, p_experiment_id text, p_dedupe_key text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_student_account(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_exam_paper(p_student_id uuid, p_subject text, p_grade text, p_chapters integer[], p_template_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_student_notifications(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_weekly_study_plan(p_student_id uuid, p_subject text, p_daily_minutes integer, p_days integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_available_subjects(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_available_subjects_v2(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_bloom_progression(p_student_id uuid, p_subject text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_board_exam_questions(p_subject text, p_grade text, p_count integer, p_year integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_chapter_rag_content(p_grade text, p_subject text, p_chapter_number integer, p_content_type text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_competition_leaderboard(p_competition_id uuid, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_competitions(p_student_id uuid, p_status text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_data(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_due_reviews(p_student_id uuid, p_subject_code text, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_guardian_dashboard(p_guardian_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_hall_of_fame(p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_knowledge_gaps(p_student_id uuid, p_subject text, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(p_period text, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_guardian_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_guardian_student_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_student_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_teacher_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_teacher_student_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_ncert_coverage_report(p_grade text, p_subject text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_quiz_questions(p_subject text, p_grade text, p_count integer, p_difficulty integer, p_chapter_number integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_review_cards(p_student_id uuid, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_school_classes(p_school_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_school_dashboard_stats(p_school_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_school_students(p_school_id uuid, p_class_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_school_teachers(p_school_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_student_id_for_auth() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_student_notifications(p_student_id uuid, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_student_snapshot(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_study_plan(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_permissions(p_auth_user_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role(p_auth_user_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_guardian_of(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_teacher_of(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_competition(p_student_id uuid, p_competition_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_guardian_to_student_via_code(p_guardian_id uuid, p_invite_code text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read(p_student_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[], p_query_embedding vector) FROM anon;
REVOKE EXECUTE ON FUNCTION public.select_quiz_questions_v2(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer, p_count integer, p_difficulty_mode text, p_question_types text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_quiz_session(p_student_id uuid, p_question_ids uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.student_join_class(p_student_id uuid, p_class_code text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_challenge_attempt(p_student_id uuid, p_challenge_id uuid, p_solved boolean, p_moves integer, p_hints_used integer, p_distractors_excluded integer, p_time_spent integer, p_coins_earned integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_results(p_student_id uuid, p_subject text, p_grade text, p_topic text, p_chapter integer, p_responses jsonb, p_time integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_results_v2(p_session_id uuid, p_student_id uuid, p_subject text, p_grade text, p_topic text, p_chapter integer, p_responses jsonb, p_time integer, p_idempotency_key uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.track_ai_quality(p_subject text, p_is_thumbs_up boolean, p_is_report boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tutor_commit_attempt(p_attempt_id uuid, p_student_id uuid, p_concept_id uuid, p_correct boolean, p_chosen_index integer, p_response_time_ms integer, p_question_id text, p_subject_code text, p_chapter_number integer, p_occurred_at timestamp with time zone, p_event_id uuid, p_idempotency_key text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_chapter_progress(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer) FROM anon;
