-- Migration: perf_covering_indexes_batch_a
-- Date: 2026-05-15
-- Purpose: Add covering btree indexes for unindexed foreign keys flagged by
--          Supabase performance advisor (lint: unindexed_foreign_keys).
--          Batch A — AI/observability + learner-event tables (15 of 30).
--          Batch B follows in 20260515000004.
-- Pattern matches the prior covering-indexes migration (20260408000007):
-- plain CREATE INDEX IF NOT EXISTS (not CONCURRENTLY) so the statement runs
-- inside Supabase's transactional migration runner.

CREATE INDEX IF NOT EXISTS idx_admin_support_notes_admin_id
  ON public.admin_support_notes (admin_id);

CREATE INDEX IF NOT EXISTS idx_ai_issue_reports_foxy_message_id
  ON public.ai_issue_reports (foxy_message_id);
CREATE INDEX IF NOT EXISTS idx_ai_issue_reports_question_bank_id
  ON public.ai_issue_reports (question_bank_id);
CREATE INDEX IF NOT EXISTS idx_ai_issue_reports_student_id
  ON public.ai_issue_reports (student_id);
CREATE INDEX IF NOT EXISTS idx_ai_issue_reports_trace_id
  ON public.ai_issue_reports (trace_id);

CREATE INDEX IF NOT EXISTS idx_ai_workflow_traces_auth_user_id
  ON public.ai_workflow_traces (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_alert_dispatches_channel_id
  ON public.alert_dispatches (channel_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_created_by
  ON public.alert_rules (created_by);

CREATE INDEX IF NOT EXISTS idx_concept_attempts_concept_id
  ON public.concept_attempts (concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_concept_id
  ON public.concept_mastery (concept_id);

CREATE INDEX IF NOT EXISTS idx_ff_grounded_ai_enforced_pairs_enabled_by
  ON public.ff_grounded_ai_enforced_pairs (enabled_by);

CREATE INDEX IF NOT EXISTS idx_foxy_quality_scores_session_id
  ON public.foxy_quality_scores (session_id);

CREATE INDEX IF NOT EXISTS idx_notification_channels_created_by
  ON public.notification_channels (created_by);

CREATE INDEX IF NOT EXISTS idx_question_bank_fix_history_agent_run_id
  ON public.question_bank_fix_history (agent_run_id);

CREATE INDEX IF NOT EXISTS idx_question_misconceptions_remediation_chunk_id
  ON public.question_misconceptions (remediation_chunk_id);
