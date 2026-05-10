-- Revoke EXECUTE on 186 internal/orphaned functions to address Supabase advisor
-- *_security_definer_function_executable WARNs (Buckets 2+3+4 from
-- docs/superpowers/runbooks/2026-05-09-function-executable-triage.md).
--
-- POST-APPLY EXPECTATION: advisor count drops by ~378 (189 REVOKE statements ×
-- 2 roles each — anon + authenticated). The 189 statements cover 186 unique
-- function names; three names have two overloads each in production
-- (activate_subscription, award_xp, check_rate_limit) so each overload gets
-- its own REVOKE.
--
-- Service-role bypasses GRANT/REVOKE entirely, so revoking from anon and
-- authenticated does NOT break anything called from supabase-admin.ts, edge
-- functions using SUPABASE_SERVICE_ROLE_KEY, or triggers (Postgres calls
-- trigger functions internally regardless of grants).
--
-- Idempotency: REVOKE on an already-revoked GRANT is a no-op, so this
-- migration is safe to re-run.
--
-- ROLLBACK if anything breaks: see commented patterns at the bottom of the file.
--
-- Reference: https://supabase.com/docs/guides/database/database-linter

-- ── Bucket 2: Service-role / SQL-internal (54 names, 56 REVOKEs) ─────
-- These are called only by:
--   * src/lib/supabase-admin.ts (service-role client) — payments, internal admin
--   * Edge functions that pass SUPABASE_SERVICE_ROLE_KEY
--   * Other SQL functions (callable internally without EXECUTE grant)
-- Revoking from anon/authenticated is safe; service_role bypasses GRANT.

REVOKE EXECUTE ON FUNCTION public.activate_subscription(p_auth_user_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_order_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_subscription(p_auth_user_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_order_id text, p_razorpay_subscription_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_subscription_locked(p_auth_user_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_order_id text, p_razorpay_subscription_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_xp(p_student_id uuid, p_xp integer, p_source text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_repair_user_onboarding(p_auth_user_id uuid, p_force_role text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_dead_subject_enrollments() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_cancel_subscription(p_student_id uuid, p_immediate boolean, p_reason text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_downgrade_subscription(p_student_id uuid, p_cancelled_sub_id text, p_new_status text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_subscription_activation(p_student_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_subscription_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(p_student_id uuid, p_plan_code text, p_billing_cycle text, p_razorpay_payment_id text, p_razorpay_subscription_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.available_chapters_for_student_subject(p_student_id uuid, p_subject_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_coins(p_student_id uuid, p_amount integer, p_source text, p_metadata jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_xp(p_student_id uuid, p_amount integer, p_source text, p_subject text, p_daily_category text, p_daily_cap integer, p_metadata jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_xp(p_student_id uuid, p_subject text, p_xp integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_account_deletion(p_account_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_and_award_achievements(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_expired_subscriptions() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_verification_batch(p_batch_size integer, p_claimed_by text, p_claim_ttl_seconds integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_session_cognitive_metrics(p_student_id uuid, p_quiz_session_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_student_affective_profile(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_subject_content_readiness() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_event(p_event_type text, p_aggregate_type text, p_aggregate_id uuid, p_payload jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_alert_rules(p_rule_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.experiment_coins_today(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_diagram_references(p_grade text, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_monthly_report(p_student_id uuid, p_month date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_adaptive_questions_v2(p_student_id uuid, p_subject text, p_limit integer, p_include_review boolean, p_mode text, p_goal text, p_source_tags text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_concepts(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_progress(p_student_id uuid, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_qa_from_rag(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_ncert_questions(p_subject text, p_grade text, p_chapter integer, p_question_type text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_plan_limit(p_student_id uuid, p_feature text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_subject_violations(p_plan text, p_grade text, p_stream text, p_limit integer, p_offset integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.halt_subscription(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hybrid_rag_search(query_text text, query_embedding vector, p_subject text, p_grade text, p_chapter text, match_count integer, vector_weight double precision, text_weight double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_lab_badge(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_subscription_past_due(p_student_id uuid, p_grace_days integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_webhook_event_processed(p_id uuid, p_outcome text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_rag_chunks(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text, query_embedding vector, p_board text, p_min_quality double precision, p_syllabus_version text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_rag_chunks_ncert(query_text text, p_subject_code text, p_grade text, match_count integer, p_chapter_number integer, p_chapter_title text, p_concept text, p_content_type text, p_min_quality double precision, query_embedding vector) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_contract_number(p_financial_year text, p_state_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(p_financial_year text, p_state_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rag_grounding_check(p_grade text, p_subject text, p_chapter_num integer, p_language text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalibrate_question_irt_2pl(p_question_id uuid, p_min_attempts integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_subject_content_readiness_daily() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_payment(p_reconciliation_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_xp(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_webhook_event(p_account_id text, p_event_id text, p_event_type text, p_raw_payload jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_account_deletion(p_account_id uuid, p_role text, p_reason text, p_auth_user_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_notification(p_recipient_id uuid, p_recipient_type text, p_type text, p_title text, p_body text, p_data jsonb, p_channel text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_student_subjects(p_student_id uuid, p_subjects text[], p_preferred text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transition_content_status(p_table text, p_id uuid, p_new_status text, p_actor_id uuid, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_burst_progress(p_student_id uuid, p_action_type text, p_value integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_concept_mastery_bkt(p_student_id uuid, p_topic_id uuid, p_is_correct boolean, p_p_learn double precision, p_p_slip double precision, p_p_guess double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_irt_theta(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_academic_scope(p_student_id uuid, p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;

-- ── Bucket 3: Trigger functions (13 names, 13 REVOKEs) ───────────────
-- These are wired only via CREATE TRIGGER. Postgres calls them internally
-- regardless of GRANTs.

REVOKE EXECUTE ON FUNCTION public.audit_student_changes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cbse_syllabus_normalize_display() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_alert_rules_for_event() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_verified() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_login() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_student_created() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_welcome_email_on_confirm() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_welcome_email_on_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_quiz_session_school_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_slp_school_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_quiz_session_affective_state() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_update_irt_theta() FROM anon, authenticated;

-- ── Bucket 4: Orphaned baseline artifacts (119 names, 120 REVOKEs) ───
-- Functions defined in baseline_from_prod with no current source-code
-- references and no triggers found. Revoking EXECUTE locks them down.
-- Follow-up: identify which can be DROPped entirely (separate migration).

REVOKE EXECUTE ON FUNCTION public.admin_create_mapping(p_admin_auth_id uuid, p_guardian_id uuid, p_student_id uuid, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_override_mapping(p_admin_auth_id uuid, p_link_id uuid, p_action text, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_status(p_admin_auth_id uuid, p_target_auth_user_id uuid, p_action text, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_old_data(p_days integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_processed_events(p_older_than interval) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_setup_student() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bkt_update(p_student_id uuid, p_node_code text, p_is_correct boolean, p_response_time_ms integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bkt_update_personalized(p_student_id uuid, p_concept_id uuid, p_is_correct boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.build_interleave_queue(p_student_id uuid, p_subject text, p_session_size integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bulk_generate_hpc(p_class_id uuid, p_academic_year text, p_term text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bulk_transition_status(p_table text, p_ids uuid[], p_new_status text, p_actor_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_rl_reward(p_student_id uuid, p_action_id uuid, p_is_correct boolean, p_response_time integer, p_engagement_score double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calibrate_irt_parameters() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_entitlement(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_foxy_quota(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_permission(p_auth_user_id uuid, p_permission_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_plan_limits(p_student_id uuid, p_usage_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(p_identifier text, p_endpoint text, p_max_per_minute integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(p_key text, p_max integer, p_window integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_ncert_batch(p_batch_size integer, p_max_file_size bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.classify_response_error(p_response_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_foxy_cache() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_daily_usage() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_rate_limits() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_usage() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_versions(p_keep integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_ops_events() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_poll_and_get_results(p_poll_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(p_student_id uuid, p_name text, p_grade text, p_board text, p_subject text, p_language text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_chapters_needing_concepts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_cms_version(p_entity_type text, p_entity_id uuid, p_snapshot jsonb, p_change_summary text, p_created_by uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_guardian_profile(p_auth_id uuid, p_name text, p_email text, p_phone text, p_relationship text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_student_profile(p_auth_user_id uuid, p_name text, p_email text, p_grade text, p_board text, p_language text, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_teacher_profile(p_auth_user_id uuid, p_name text, p_email text, p_school_name text, p_subjects text[], p_grades text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_school_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delta_sync_pull(p_student_id uuid, p_device_id text, p_mastery_since timestamp with time zone, p_graph_since timestamp with time zone, p_questions_since timestamp with time zone, p_schedule_since timestamp with time zone) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.diagnose_student(p_student_id uuid, p_subject_code text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_tutoring_session(p_session_id uuid, p_summary text, p_key_learnings text[], p_areas_for_improvement text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.estimate_student_theta(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fast_rag_search(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fast_rag_search_v2(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_matching_simulation(p_subject text, p_grade text, p_message text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.flush_offline_queue(p_student_id uuid, p_device_id text, p_actions jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_at_risk_alerts(p_class_id uuid, p_teacher_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_daily_plan(p_student_id uuid, p_date date, p_minutes_available integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_hpc(p_student_id uuid, p_academic_year text, p_term text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_learning_path(p_student_id uuid, p_subject text, p_grade text, p_path_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_parent_link_code(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_review_card_from_quiz(p_student_id uuid, p_question_id uuid, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_smart_nudges(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_bursts(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cache_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_content(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_media(p_grade text, p_subject text, p_chapter_number integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_qa(p_grade text, p_subject text, p_chapter_number integer, p_source_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapter_simulations(p_subject text, p_grade text, p_chapter integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_chapters_needing_concepts(p_batch_size integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_class_mastery_heatmap(p_class_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_competency_report(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_daily_xp_by_category(p_student_id uuid, p_category text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_exercise_completion(p_student_id uuid, p_subject_code text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_learning_snapshot(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_guardian_student_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_student_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_teacher_student_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_narrative_state(p_student_id uuid, p_burst_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_ncert_chapter_stats(p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_next_topic(p_student_id uuid, p_subject_code text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_link_requests(p_student_auth_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_practice_queue(p_student_id uuid, p_subject text, p_grade text, p_session_size integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_questions_for_node(p_node_code text, p_count integer, p_bloom_level text, p_exclude_ids uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_chunks_for_node(p_node_code text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_context_for_adaptive(p_student_id uuid, p_node_code text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_context_for_cme(p_student_id uuid, p_concept_id uuid, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_rag_context_for_sr_card(p_grade text, p_subject text, p_chapter_number integer, p_bloom_level text, p_limit integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_simulation(p_sim_id uuid, p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_student_plan(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_student_progress(p_student_id uuid, p_subject_code text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_student_usage(p_student_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_teacher_dashboard_v2(p_teacher_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_vault_secret(secret_name text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_daily_usage(p_student_id uuid, p_feature text, p_usage_date date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.instant_rag_search(query_text text, p_subject text, p_grade text, match_count integer, p_chapter text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.launch_classroom_poll(p_teacher_id uuid, p_class_id uuid, p_question_text text, p_options jsonb, p_correct_index integer, p_question_type text, p_time_limit integer, p_node_code text, p_bloom_level text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.launch_narrative_burst(p_student_id uuid, p_subject text, p_template_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_guardian_via_invite_code(p_guardian_auth_id uuid, p_invite_code text, p_relation_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit(p_auth_user_id uuid, p_action text, p_resource_type text, p_resource_id text, p_details jsonb, p_status text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lookup_foxy_cache(p_q text, p_grade text, p_subject text, p_lang text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_syllabus_concept(p_query text, p_subject text, p_grade text, p_match_count integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_student_grade(p_student_id uuid, p_new_grade text, p_new_session text, p_actor_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quiz_grounding_check(p_grade text, p_subject text, p_chapter_num integer, p_question_text text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rag_resolve_chapter(p_grade text, p_subject text, p_query text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rag_validate_answer(p_log_id uuid, p_chunks_used integer, p_confidence double precision, p_has_ncert_cite boolean, p_answer_length integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_stuck_payments() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_adaptive_response(p_student_id uuid, p_node_code text, p_is_correct boolean, p_response_time_ms integer, p_source text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_daily_activity(p_student_id uuid, p_subject text, p_questions_asked integer, p_questions_correct integer, p_xp_earned integer, p_time_minutes integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_leaderboard_week() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_platform_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.renew_subscription(p_student_id uuid, p_razorpay_payment_id text, p_amount_inr integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_guardian_link(p_guardian_auth_id uuid, p_student_email text, p_relation_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_guardian_link(p_requester_auth_id uuid, p_link_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_retention_test() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_spaced_review(p_student_id uuid, p_topic_id uuid, p_quality integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_adaptive_mastery(p_student_id uuid, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.select_next_content(p_student_id uuid, p_subject text, p_grade text, p_epsilon double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_context(p_school_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_connection_health() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.student_respond_to_link_request(p_student_auth_id uuid, p_link_id uuid, p_action text, p_reason text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_poll_response(p_poll_id uuid, p_student_id uuid, p_answer_index integer, p_answer_text text, p_response_time_ms integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_results_rpc(p_student_id uuid, p_started_at timestamp with time zone, p_finished_at timestamp with time zone, p_items jsonb, p_subject text, p_grade text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_results_safe(p_student_id uuid, p_items jsonb, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_onboarding_completed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_roles_for_user(p_auth_user_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.teacher_create_adaptive_assignment(p_teacher_id uuid, p_class_id uuid, p_title text, p_node_codes text[], p_due_date timestamp with time zone, p_question_count integer, p_bloom_level text, p_assignment_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_concept_mastery(p_student_id uuid, p_topic_id uuid, p_is_correct boolean, p_used_hint boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_ncert_chapter_progress() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_streak(p_student_id uuid, p_subject text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_content_gap(p_subject text, p_grade text, p_query text, p_topic_title text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.write_foxy_cache(p_q text, p_resp text, p_grade text, p_subject text, p_ch integer, p_topic text, p_model text, p_lang text) FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- ROLLBACK (if a function in Buckets 2/3/4 turns out to be needed):
-- ────────────────────────────────────────────────────────────────────
-- For functions that need authenticated access:
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated;
--
-- For functions that need anon access (rare):
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon;
--
-- Re-run advisors via Supabase MCP get_advisors after rollback to verify.
-- Reference for signatures: query
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc JOIN pg_namespace ON pronamespace = pg_namespace.oid
--   WHERE nspname = 'public';
