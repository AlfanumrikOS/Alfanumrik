-- Migration: covering_indexes_for_unindexed_foreign_keys
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: Add covering indexes for all 31 unindexed foreign keys flagged by
--          Supabase performance advisor (lint: 0001_unindexed_foreign_keys).
--          Prevents full table scans on FK lookups during JOIN operations.

CREATE INDEX IF NOT EXISTS idx_adaptive_interactions_topic_id
  ON public.adaptive_interactions (topic_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_role_id
  ON public.api_keys (role_id);
CREATE INDEX IF NOT EXISTS idx_backup_status_verified_by
  ON public.backup_status (verified_by);
CREATE INDEX IF NOT EXISTS idx_chapter_progress_chapter_id
  ON public.chapter_progress (chapter_id);
CREATE INDEX IF NOT EXISTS idx_classroom_poll_responses_student_id
  ON public.classroom_poll_responses (student_id);
CREATE INDEX IF NOT EXISTS idx_cms_assets_uploaded_by
  ON public.cms_assets (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_cms_item_versions_created_by
  ON public.cms_item_versions (created_by);
CREATE INDEX IF NOT EXISTS idx_cms_item_versions_reviewed_by
  ON public.cms_item_versions (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_cms_item_versions_published_by
  ON public.cms_item_versions (published_by);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_created_by
  ON public.curriculum_topics (created_by);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_updated_by
  ON public.curriculum_topics (updated_by);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_reviewed_by
  ON public.curriculum_topics (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_published_by
  ON public.curriculum_topics (published_by);
CREATE INDEX IF NOT EXISTS idx_deployment_history_triggered_by
  ON public.deployment_history (triggered_by);
CREATE INDEX IF NOT EXISTS idx_exam_simulations_exam_config_id
  ON public.exam_simulations (exam_config_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_missing_prerequisite_id
  ON public.knowledge_gaps (missing_prerequisite_id);
CREATE INDEX IF NOT EXISTS idx_learning_velocity_concept_id
  ON public.learning_velocity (concept_id);
CREATE INDEX IF NOT EXISTS idx_narrative_progress_burst_id
  ON public.narrative_progress (burst_id);
CREATE INDEX IF NOT EXISTS idx_pilot_daily_metrics_cohort_id
  ON public.pilot_daily_metrics (cohort_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_created_by
  ON public.question_bank (created_by);
CREATE INDEX IF NOT EXISTS idx_question_bank_updated_by
  ON public.question_bank (updated_by);
CREATE INDEX IF NOT EXISTS idx_question_bank_reviewed_by
  ON public.question_bank (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_question_bank_published_by
  ON public.question_bank (published_by);
CREATE INDEX IF NOT EXISTS idx_rag_neighbor_cache_neighbor_id
  ON public.rag_neighbor_cache (neighbor_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred_id
  ON public.referral_rewards (referred_id);
CREATE INDEX IF NOT EXISTS idx_resource_access_rules_role_id
  ON public.resource_access_rules (role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id
  ON public.role_permissions (permission_id);
CREATE INDEX IF NOT EXISTS idx_student_burst_progress_burst_id
  ON public.student_burst_progress (burst_id);
CREATE INDEX IF NOT EXISTS idx_student_nipun_scores_competency_id
  ON public.student_nipun_scores (competency_id);
CREATE INDEX IF NOT EXISTS idx_teacher_student_notes_student_id
  ON public.teacher_student_notes (student_id);
CREATE INDEX IF NOT EXISTS idx_user_question_history_question_id
  ON public.user_question_history (question_id);
