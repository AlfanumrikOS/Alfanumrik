-- Fix function_search_path_mutable advisor WARNs (40 functions).
--
-- Background: PostgreSQL functions without an explicit `search_path` are
-- vulnerable to schema-poisoning attacks. An attacker who can create
-- objects in any schema present in the runtime search path could shadow
-- the function's references (tables, types, operators) and inject
-- malicious behaviour. Pinning `search_path` to a known set of schemas
-- closes this hole.
--
-- This migration sets `search_path = public, pg_catalog` for every
-- function flagged by the Supabase performance/security advisor under
-- the `function_search_path_mutable` lint
-- (https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).
--
-- The two functions that reference the `auth` schema (auth.uid(),
-- auth.users) get `search_path = public, auth, pg_catalog` so they
-- resolve correctly even though they currently schema-qualify their
-- auth references explicitly.
--
-- `ALTER FUNCTION ... SET ...` is idempotent and re-running this
-- migration is safe.
--
-- Source: pg_get_function_identity_arguments() at the time of writing
-- (Postgres 17.6, project shktyoxqhundlvkiwguu).

-- --- Functions that reference the auth schema ---------------------------
ALTER FUNCTION public.get_available_subjects(p_student_id uuid) SET search_path = public, auth, pg_catalog;
ALTER FUNCTION public.set_student_subjects(p_student_id uuid, p_subjects text[], p_preferred text) SET search_path = public, auth, pg_catalog;

-- --- All other flagged functions (default search_path) ------------------
ALTER FUNCTION public.cleanup_ops_events() SET search_path = public, pg_catalog;
ALTER FUNCTION public.content_request_ist_day(ts timestamp with time zone) SET search_path = public, pg_catalog;
ALTER FUNCTION public.content_request_utc_day(ts timestamp with time zone) SET search_path = public, pg_catalog;
ALTER FUNCTION public.distinct_chapter_tuples_from_bank() SET search_path = public, pg_catalog;
ALTER FUNCTION public.distinct_chapter_tuples_from_chunks() SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_subject_enrollment() SET search_path = public, pg_catalog;
ALTER FUNCTION public.evaluate_alert_rules(p_rule_id uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.evaluate_alert_rules_for_event() SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_ncert_questions(p_subject text, p_grade text, p_chapter integer, p_question_type text, p_limit integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_rag_chunks_for_node(p_node_code text, p_limit integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_rag_context_for_adaptive(p_student_id uuid, p_node_code text, p_limit integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_rag_context_for_cme(p_student_id uuid, p_concept_id uuid, p_limit integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_rag_context_for_sr_card(p_grade text, p_subject text, p_chapter_number integer, p_bloom_level text, p_limit integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_subject_violations(p_plan text, p_grade text, p_stream text, p_limit integer, p_offset integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.is_devanagari_mojibake(p_text text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.normalize_grade(p_grade text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.prq_set_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.purge_old_grounded_traces() SET search_path = public, pg_catalog;
ALTER FUNCTION public.quiz_grounding_check(p_grade text, p_subject text, p_chapter_num integer, p_question_text text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.rag_grounding_check(p_grade text, p_subject text, p_chapter_num integer, p_language text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.rag_resolve_chapter(p_grade text, p_subject text, p_query text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.rag_validate_answer(p_log_id uuid, p_chunks_used integer, p_confidence double precision, p_has_ncert_cite boolean, p_answer_length integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.school_contracts_set_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.severity_rank(sev text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.subject_code_to_rag_name(p_code text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.submit_quiz_results(p_student_id uuid, p_subject text, p_grade text, p_topic text, p_chapter integer, p_responses jsonb, p_time integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_account_deletion_log_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_challenge_streaks_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_class_enrollments_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_coin_balances_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_learning_objectives_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_performance_scores_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_school_announcements_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_school_api_keys_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_school_exams_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_school_invoices_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_school_questions_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_student_skill_state_updated_at() SET search_path = public, pg_catalog;
