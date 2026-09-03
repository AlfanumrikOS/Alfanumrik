-- 20260903070000_p2_5_db_hygiene_phase1_indexes_and_rls_initplan.sql
--
-- P2-5 (2026-09-03 launch audit) — Phase 1 of database hygiene: the
-- mechanical, verified-safe subset of live Supabase performance-advisor
-- output (mcp get_advisors, type=performance) plus direct pg_catalog
-- queries run against production before writing this file.
--
-- Explicitly OUT OF SCOPE here (tracked as separate, larger follow-up
-- work — see the launch-audit status report):
--   - unused_index (657 findings): the advisor's own caveat applies —
--     "unused" is a since-stats-reset heuristic, and a rarely-hit index can
--     still be load-bearing for an important-but-rare query. Needs a
--     longer observation window and per-index judgment, not a bulk drop.
--   - multiple_permissive_policies (156 findings): consolidating RLS
--     policies risks silently changing access semantics (multiple
--     permissive policies OR together — merge them wrong and you either
--     lock out a legitimate caller or open a hole). Needs case-by-case
--     review, not a mechanical sweep.
--   - no_primary_key (10 findings): investigated live, not migrated here.
--     4 of the 10 (security_request_usage_{daily,monthly},
--     security_tenant_ai_usage_{daily,monthly}) already have a UNIQUE
--     index (`<table>_quota_key_unique`) explicitly set as their
--     REPLICA IDENTITY (migration 20260620001100) — a deliberate prior
--     design choice, not a gap; adding a formal PK on top is unnecessary
--     churn. 5 are one-off dated backup/archive tables
--     (_ao10b_grade_backfill_backup, _tsb4_isactive_backfill_backup,
--     grade_subject_map_archive_20260814, _rls_policy_backup_20260818,
--     _feature_flags_dead_flags_backup_20260831) that were never meant to
--     carry a PK. The 10th, edge_health_probe_requests, has genuinely no
--     index of any kind and is written to only by the `edge-health-audit`
--     Edge Function, which is deployed with no source in this repo — the
--     same orphaned-function situation already flagged to the CEO as P1-7.
--     Adding a PK blind, without seeing the actual INSERT pattern, risks
--     breaking writes from code I can't read; deferred to whatever the
--     user decides on P1-7.
--   - table_bloat on net._http_response (pg_net's internal response log):
--     handled live as a one-off `VACUUM (ANALYZE)`, not via migration —
--     it's a maintenance operation on an extension-owned table, not a
--     schema change, and the table was already small (27 MB / 684 rows,
--     actively churning) at the time this was investigated.
--   - auth_db_connections_absolute: a Supabase project *setting*
--     recommendation (switch the Auth server's connection allocation from
--     absolute to percentage-based), not something expressible in SQL —
--     left as a dashboard action for the user.
--
-- ═══════════════════════════════════════════════════════════════════════
-- PART 1 — 12 unindexed foreign keys. Each was confirmed live (pg_indexes)
-- to have no existing index with these columns as a leading prefix.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_foxy_chat_messages_session_student
  ON public.foxy_chat_messages (session_id, student_id);

CREATE INDEX IF NOT EXISTS idx_foxy_decision_log_school_id
  ON public.foxy_decision_log (school_id);

CREATE INDEX IF NOT EXISTS idx_foxy_events_school_id
  ON public.foxy_events (school_id);

CREATE INDEX IF NOT EXISTS idx_foxy_pending_expectations_answered_message_id
  ON public.foxy_pending_expectations (answered_message_id);

CREATE INDEX IF NOT EXISTS idx_foxy_pending_expectations_asked_message_id
  ON public.foxy_pending_expectations (asked_message_id);

CREATE INDEX IF NOT EXISTS idx_foxy_pending_expectations_topic_id
  ON public.foxy_pending_expectations (topic_id);

CREATE INDEX IF NOT EXISTS idx_restore_drill_log_source_backup_id
  ON public.restore_drill_log (source_backup_id);

CREATE INDEX IF NOT EXISTS idx_run_events_step_id
  ON public.run_events (step_id);

CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_author_user_id
  ON public.support_ticket_replies (author_user_id);

CREATE INDEX IF NOT EXISTS idx_teacher_assignment_drafts_class_id
  ON public.teacher_assignment_drafts (class_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_consent_events_parental_consent_id
  ON public.whatsapp_consent_events (parental_consent_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_identity_id
  ON public.whatsapp_message_log (identity_id);

-- ═══════════════════════════════════════════════════════════════════════
-- PART 2 — 24 duplicate indexes. Verified byte-identical via pg_indexes
-- .indexdef (same columns, same predicate, same access method) before
-- writing this. 22 are plain (non-constraint-backed) indexes: index names
-- are never referenced by app code, so dropping either twin is behavior-
-- neutral — kept the more descriptive/consistent name in each pair.
-- ═══════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_adaptive_interventions_verify_by;
DROP INDEX IF EXISTS public.idx_ap_student;
DROP INDEX IF EXISTS public.idx_admin_audit_created;
DROP INDEX IF EXISTS public.agent_steps_run_state_idx;
DROP INDEX IF EXISTS public.idx_class_students_class;
DROP INDEX IF EXISTS public.idx_class_students_student;
DROP INDEX IF EXISTS public.idx_class_teachers_class;
DROP INDEX IF EXISTS public.idx_class_teachers_teacher;
DROP INDEX IF EXISTS public.idx_comp_status;
DROP INDEX IF EXISTS public.idx_da_date_desc;
DROP INDEX IF EXISTS public.idx_engagement_student;
DROP INDEX IF EXISTS public.idx_foxy_chat_messages_session_id;
DROP INDEX IF EXISTS public.idx_learning_velocity_student;
DROP INDEX IF EXISTS public.idx_parental_consent_active;
DROP INDEX IF EXISTS public.idx_payments_razorpay;
DROP INDEX IF EXISTS public.idx_payment_history_student_created;
DROP INDEX IF EXISTS public.idx_qb_chapter_id;
DROP INDEX IF EXISTS public.idx_qb_subject_grade_chapter;
DROP INDEX IF EXISTS public.idx_qs_created;
DROP INDEX IF EXISTS public.idx_sr_review;
DROP INDEX IF EXISTS public.idx_spt_plan;
DROP INDEX IF EXISTS public.idx_study_plans_student;

-- The remaining 2 pairs are UNIQUE-CONSTRAINT-backed (confirmed via
-- pg_constraint), so they're dropped via ALTER TABLE ... DROP CONSTRAINT
-- (which drops the backing index too), each keeping the side that matters:
--   - user_roles_auth_user_id_role_id_key MUST survive: it's referenced
--     by name (`ON CONFLICT ON CONSTRAINT
--     user_roles_auth_user_id_role_id_key`) in migrations
--     20260803140000 and 20260816000008. user_roles_unique is the
--     unreferenced duplicate — 20260803140000's own header comment
--     already calls it out as "(and a duplicate user_roles_unique)".
--   - Neither user_question_history unique constraint is referenced by
--     name anywhere in this codebase (every call site uses `ON CONFLICT
--     (student_id, question_id)`, which Postgres resolves by column
--     match, not by constraint name) — kept the more descriptively-named
--     uq_ constraint, dropped the auto-generated-name one.
ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_unique;
ALTER TABLE public.user_question_history
  DROP CONSTRAINT IF EXISTS user_question_history_student_id_question_id_key;

-- ═══════════════════════════════════════════════════════════════════════
-- PART 3 — auth_rls_initplan: wrap bare auth.<fn>() calls in RLS policies
-- with (select auth.<fn>()) so Postgres evaluates them once per statement
-- (an initplan) instead of once per row at scale. Pure performance fix:
-- auth.uid()/auth.role() are STABLE and return the same value for the
-- whole statement either way — this changes ONLY how often Postgres calls
-- them, never what they return, so policy semantics are unchanged. Every
-- USING/WITH CHECK expression below is the EXACT current pg_policies
-- definition with only `auth.uid()`/`auth.role()` mechanically wrapped
-- (verified via a script, not hand-retyped, to rule out transcription
-- drift in this nested SQL).
--
-- The live-advisor cache flagged 11 policies; a direct pg_policies query
-- run before writing this migration showed 3 of them
-- (connection_budget.svc_conn_budget, connection_health_log.svc_conn_health,
-- foxy_response_cache.svc_fc) were ALREADY fixed in the live database —
-- the advisor result is a periodic cache (its own observed_at timestamp
-- proves this), not a live computation. Only the 8 genuinely-unfixed
-- policies are touched below.
-- ═══════════════════════════════════════════════════════════════════════

ALTER POLICY foxy_dim_feedback_read_self ON public.foxy_message_dimension_feedback
  USING ((((select auth.role()) = 'service_role'::text) OR (student_id IN ( SELECT students.id
   FROM students
  WHERE (students.auth_user_id = (select auth.uid()))))));

ALTER POLICY foxy_dim_feedback_write_service ON public.foxy_message_dimension_feedback
  USING (((select auth.role()) = 'service_role'::text));

ALTER POLICY foxy_pending_expectations_student_read ON public.foxy_pending_expectations
  USING ((EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = foxy_pending_expectations.student_id) AND (s.auth_user_id = (select auth.uid()))))));

ALTER POLICY learner_state_write_failures_service_all ON public.learner_state_write_failures
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

ALTER POLICY foxy_session_guardians_can_receive ON realtime.messages
  USING (((topic ~~ 'foxy:session:%'::text) AND (split_part(topic, ':'::text, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (EXISTS ( SELECT 1
   FROM ((foxy_sessions fs
     JOIN students s ON ((s.id = fs.student_id)))
     JOIN guardians g ON ((g.auth_user_id = (select auth.uid()))))
  WHERE ((fs.id = (split_part(messages.topic, ':'::text, 3))::uuid) AND (EXISTS ( SELECT 1
           FROM guardian_student_links gsl
          WHERE ((gsl.student_id = s.id) AND (gsl.guardian_id = g.id) AND (COALESCE(gsl.status, 'pending'::text) = ANY (ARRAY['active'::text, 'approved'::text])) AND (gsl.revoked_at IS NULL)))))))));

ALTER POLICY foxy_session_members_can_receive ON realtime.messages
  USING (((topic ~~ 'foxy:session:%'::text) AND (split_part(topic, ':'::text, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (EXISTS ( SELECT 1
   FROM (foxy_sessions fs
     JOIN students st ON ((st.id = fs.student_id)))
  WHERE ((fs.id = (split_part(messages.topic, ':'::text, 3))::uuid) AND (st.auth_user_id = (select auth.uid())))))));

ALTER POLICY foxy_session_teachers_can_receive ON realtime.messages
  USING (((topic ~~ 'foxy:session:%'::text) AND (split_part(topic, ':'::text, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (EXISTS ( SELECT 1
   FROM ((foxy_sessions fs
     JOIN students s ON ((s.id = fs.student_id)))
     JOIN teachers t ON ((t.auth_user_id = (select auth.uid()))))
  WHERE ((fs.id = (split_part(messages.topic, ':'::text, 3))::uuid) AND ((EXISTS ( SELECT 1
           FROM teacher_student_links tsl
          WHERE ((tsl.teacher_id = t.id) AND (tsl.student_id = s.id) AND (COALESCE(tsl.status, 'active'::text) = 'active'::text)))) OR (EXISTS ( SELECT 1
           FROM (class_students cs
             JOIN class_teachers ct ON ((ct.class_id = cs.class_id)))
          WHERE ((cs.student_id = s.id) AND (ct.teacher_id = t.id) AND COALESCE(cs.is_active, true) AND COALESCE(ct.is_active, true))))))))));

ALTER POLICY foxy_student_realtime_read ON realtime.messages
  USING (((topic ~ '^foxy:student:[0-9a-fA-F-]{36}$'::text) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.auth_user_id = (select auth.uid())) AND (s.id = (split_part(messages.topic, ':'::text, 3))::uuid))))));
