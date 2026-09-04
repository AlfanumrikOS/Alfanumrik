-- 20260904140000_p2_5_phase2_unused_index_dead_table_pass.sql
--
-- P2-5 database hygiene, continuing the `unused_index` advisor category.
-- The bulk of this category (~545 remaining findings after this migration)
-- is still correctly deferred pending a longer idx_scan observation window
-- (server uptime ~8.5 days as of the 20260904130000 duplicate-index pass;
-- recommended window is 4-6 weeks) -- this migration does NOT touch that.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS COVERS: a dead-code cross-reference, not a usage-stats judgment
-- ---------------------------------------------------------------------------
-- Swept every table behind the remaining unused_index findings for real
-- application-code references across apps/packages/supabase/functions/
-- scripts/e2e (.ts/.tsx/.js/.mjs), explicitly excluding
-- apps/host/src/types/database.types.ts (Supabase's auto-generated types
-- file, which trivially declares every table regardless of use -- a sweep
-- that includes it falsely reads as "every table is referenced").
--
-- 45 tables came back with zero real references. Before treating any of
-- them as dead, each was reconciled against live pg_stat_user_tables row
-- counts and, for any with real data, its actual write path was traced via
-- pg_proc/pg_trigger/cron.job rather than assumed dead from the grep alone.
-- That reconciliation caught 4 tables that are NOT dead despite zero
-- `.from()`/raw-SQL matches -- they're written via SECURITY DEFINER SQL
-- functions called through `.rpc()` or by active pg_cron jobs, neither of
-- which a table-name grep can see: security_request_audit and
-- security_circuit_state (platform rate-limit/circuit-breaker layer, called
-- from supabase/functions/_shared/security/{audit,circuit,quota}.ts) and
-- run_events (written by agent_complete_step/agent_timeout_sweep, both
-- fired by active pg_cron jobs agent-worker-tick-every-minute and
-- agent-timeout-sweep-every-minute). Those 3 tables' unused-index findings
-- are explicitly OUT of this migration and remain in the deferred,
-- observation-window-gated bucket. (A 4th table, ai_governance_log, is a
-- separate anomaly -- real historical data and a live admin-read policy,
-- but its only writer function appears orphaned -- flagged to the user as a
-- discovered issue, not acted on here; also excluded from this migration.)
--
-- The remaining 37 tables are genuinely dead by both signals at once: 0
-- live rows (pg_stat_user_tables.n_live_tup) AND 0 real code references.
-- Their unused, non-primary-key, non-unique indexes are dropped below --
-- 63 indexes total. This is zero-risk (nothing reads or writes these
-- tables) but also near-zero value on its own (an index on an empty table
-- is a handful of KB) -- shipped as a standalone batch per explicit user
-- direction, not because it meaningfully moves the needle on the category.
--
-- Every DROP INDEX statement below was generated directly from the live
-- pg_stat_user_indexes / pg_index query's own output (never hand-retyped).
--
-- Tables covered (37): analytics_freshness_log, audit_logs_archive,
-- cbse_question_config, cbse_syllabus_corpus_reconciliation_ledger,
-- cbse_syllabus_graph, connection_health_log, conversation_messages,
-- cycle_goal_inbox, embedding_backfill_queue, exam_paper_templates,
-- formative_assessments, foxy_response_cache, gamification_bursts,
-- hall_of_fame, layer_mastery, learner_clusters, learning_loop_state,
-- narrative_templates, ncert_formulas, nipun_diagnostic_items,
-- nipun_instructional_tasks, pilot_daily_metrics, pilot_weekly_snapshots,
-- platform_analytics, rag_content_flags, rag_neighbor_cache,
-- remediation_sessions, restore_drill_log, solver_results,
-- student_avatar_preferences, student_baselines, student_concept_state,
-- student_nipun_scores, tarl_sessions, teacher_actions, tutoring_cohorts,
-- vernacular_content.

DROP INDEX IF EXISTS public.idx_freshness_stale;
DROP INDEX IF EXISTS public.audit_logs_archive_action_created_at_idx;
DROP INDEX IF EXISTS public.audit_logs_archive_actor_type_created_at_idx;
DROP INDEX IF EXISTS public.audit_logs_archive_auth_user_id_idx;
DROP INDEX IF EXISTS public.audit_logs_archive_created_at_idx;
DROP INDEX IF EXISTS public.audit_logs_archive_created_at_idx1;
DROP INDEX IF EXISTS public.audit_logs_archive_resource_type_resource_id_idx;
DROP INDEX IF EXISTS public.audit_logs_archive_school_id_created_at_idx;
DROP INDEX IF EXISTS public.audit_logs_archive_school_id_idx;
DROP INDEX IF EXISTS public.idx_cbse_qconfig_grade_subject;
DROP INDEX IF EXISTS public.idx_recon_ledger_coord;
DROP INDEX IF EXISTS public.idx_recon_ledger_run;
DROP INDEX IF EXISTS public.idx_syllabus_chapter;
DROP INDEX IF EXISTS public.idx_syllabus_search;
DROP INDEX IF EXISTS public.idx_syllabus_subject_grade;
DROP INDEX IF EXISTS public.idx_conn_health_time;
DROP INDEX IF EXISTS public.idx_messages_session;
DROP INDEX IF EXISTS public.idx_msg_related_topic;
DROP INDEX IF EXISTS public.idx_cgi_cycle;
DROP INDEX IF EXISTS public.idx_cgi_pending_queue;
DROP INDEX IF EXISTS public.idx_cgi_status;
DROP INDEX IF EXISTS public.embedding_backfill_queue_status_priority_idx;
DROP INDEX IF EXISTS public.idx_ept_grade;
DROP INDEX IF EXISTS public.idx_formative_competency;
DROP INDEX IF EXISTS public.idx_formative_tarl;
DROP INDEX IF EXISTS public.idx_foxy_ck;
DROP INDEX IF EXISTS public.idx_foxy_gs;
DROP INDEX IF EXISTS public.idx_foxy_hits;
DROP INDEX IF EXISTS public.idx_bursts_active;
DROP INDEX IF EXISTS public.idx_hall_of_fame_comp;
DROP INDEX IF EXISTS public.idx_hof_type;
DROP INDEX IF EXISTS public.idx_lm_action;
DROP INDEX IF EXISTS public.idx_lm_concept;
DROP INDEX IF EXISTS public.idx_lm_sid;
DROP INDEX IF EXISTS public.idx_lm_student;
DROP INDEX IF EXISTS public.idx_learner_clusters_grade_subject;
DROP INDEX IF EXISTS public.idx_lls_concept;
DROP INDEX IF EXISTS public.idx_lls_incomplete;
DROP INDEX IF EXISTS public.idx_narrative_templates_age;
DROP INDEX IF EXISTS public.idx_narrative_templates_grade;
DROP INDEX IF EXISTS public.idx_formulas_subject;
DROP INDEX IF EXISTS public.idx_nipun_diag_competency;
DROP INDEX IF EXISTS public.idx_nipun_tasks_competency;
DROP INDEX IF EXISTS public.idx_daily_metrics_date;
DROP INDEX IF EXISTS public.idx_pilot_daily_metrics_cohort_id;
DROP INDEX IF EXISTS public.idx_weekly_snap_cohort;
DROP INDEX IF EXISTS public.idx_platform_analytics_date;
DROP INDEX IF EXISTS public.idx_rag_flags_chunk;
DROP INDEX IF EXISTS public.idx_rag_flags_unreviewed;
DROP INDEX IF EXISTS public.idx_rag_neighbor_chunk;
DROP INDEX IF EXISTS public.idx_rs_pattern;
DROP INDEX IF EXISTS public.idx_restore_drill_log_source_backup_id;
DROP INDEX IF EXISTS public.idx_solver_subject;
DROP INDEX IF EXISTS public.idx_avatar_prefs_persona;
DROP INDEX IF EXISTS public.idx_student_avatar_prefs_avatar;
DROP INDEX IF EXISTS public.idx_baselines_cohort;
DROP INDEX IF EXISTS public.idx_scs_review;
DROP INDEX IF EXISTS public.idx_student_nipun_scores_competency_id;
DROP INDEX IF EXISTS public.idx_tarl_subject_grade;
DROP INDEX IF EXISTS public.idx_teacher_actions_comp;
DROP INDEX IF EXISTS public.idx_teacher_actions_open;
DROP INDEX IF EXISTS public.idx_tutoring_active;
DROP INDEX IF EXISTS public.idx_vc_topic;
