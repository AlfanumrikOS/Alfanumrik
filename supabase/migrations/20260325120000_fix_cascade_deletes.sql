-- ============================================================================
-- I5: Add CASCADE/SET NULL to foreign keys referencing students/teachers/guardians
--
-- PROBLEM: 30 FKs use NO ACTION. If a student is hard-deleted, every child
-- table blocks the delete with a FK violation → orphaned data or failed cleanup.
--
-- STRATEGY:
--   CASCADE: Student-owned data (learning data, quiz data, progress tracking)
--   SET NULL: Shared references (teacher notes, assignments, audit records)
-- ============================================================================

BEGIN;

-- ─── Student-owned data → CASCADE ──────────────────────────────────────────

ALTER TABLE adaptive_interactions DROP CONSTRAINT adaptive_interactions_student_id_fkey,
  ADD CONSTRAINT adaptive_interactions_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE adaptive_mastery DROP CONSTRAINT adaptive_mastery_student_id_fkey,
  ADD CONSTRAINT adaptive_mastery_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE at_risk_alerts DROP CONSTRAINT at_risk_alerts_student_id_fkey,
  ADD CONSTRAINT at_risk_alerts_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE chapter_study_sessions DROP CONSTRAINT chapter_study_sessions_student_id_fkey,
  ADD CONSTRAINT chapter_study_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE classroom_poll_responses DROP CONSTRAINT classroom_poll_responses_student_id_fkey,
  ADD CONSTRAINT classroom_poll_responses_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE interleave_queue DROP CONSTRAINT interleave_queue_student_id_fkey,
  ADD CONSTRAINT interleave_queue_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE learning_journey DROP CONSTRAINT learning_journey_student_id_fkey,
  ADD CONSTRAINT learning_journey_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE narrative_progress DROP CONSTRAINT narrative_progress_student_id_fkey,
  ADD CONSTRAINT narrative_progress_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE offline_pending_responses DROP CONSTRAINT offline_pending_responses_student_id_fkey,
  ADD CONSTRAINT offline_pending_responses_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE practice_session_log DROP CONSTRAINT practice_session_log_student_id_fkey,
  ADD CONSTRAINT practice_session_log_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE quiz_responses DROP CONSTRAINT quiz_responses_student_id_fkey,
  ADD CONSTRAINT quiz_responses_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE quiz_sessions DROP CONSTRAINT quiz_sessions_student_id_fkey,
  ADD CONSTRAINT quiz_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE student_burst_progress DROP CONSTRAINT student_burst_progress_student_id_fkey,
  ADD CONSTRAINT student_burst_progress_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE student_competency_scores DROP CONSTRAINT student_competency_scores_student_id_fkey,
  ADD CONSTRAINT student_competency_scores_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE student_daily_usage DROP CONSTRAINT student_daily_usage_student_id_fkey,
  ADD CONSTRAINT student_daily_usage_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE student_simulation_progress DROP CONSTRAINT student_simulation_progress_student_id_fkey,
  ADD CONSTRAINT student_simulation_progress_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE student_titles DROP CONSTRAINT student_titles_student_id_fkey,
  ADD CONSTRAINT student_titles_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE sync_ledger DROP CONSTRAINT sync_ledger_student_id_fkey,
  ADD CONSTRAINT sync_ledger_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE topic_mastery DROP CONSTRAINT topic_mastery_student_id_fkey,
  ADD CONSTRAINT topic_mastery_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE hall_of_fame DROP CONSTRAINT hall_of_fame_student_id_fkey,
  ADD CONSTRAINT hall_of_fame_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE hpc_records DROP CONSTRAINT hpc_records_student_id_fkey,
  ADD CONSTRAINT hpc_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- ─── Shared references → SET NULL (preserve records when actor leaves) ─────

ALTER TABLE referral_rewards DROP CONSTRAINT referral_rewards_referrer_id_fkey,
  ADD CONSTRAINT referral_rewards_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES students(id) ON DELETE SET NULL;

ALTER TABLE referral_rewards DROP CONSTRAINT referral_rewards_referred_id_fkey,
  ADD CONSTRAINT referral_rewards_referred_id_fkey FOREIGN KEY (referred_id) REFERENCES students(id) ON DELETE SET NULL;

ALTER TABLE teacher_student_notes DROP CONSTRAINT teacher_student_notes_student_id_fkey,
  ADD CONSTRAINT teacher_student_notes_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;

-- ─── Teacher FKs → SET NULL (preserve content when teacher leaves) ─────────

ALTER TABLE assignments DROP CONSTRAINT assignments_teacher_id_fkey,
  ADD CONSTRAINT assignments_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;

ALTER TABLE at_risk_alerts DROP CONSTRAINT at_risk_alerts_teacher_id_fkey,
  ADD CONSTRAINT at_risk_alerts_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;

ALTER TABLE classroom_polls DROP CONSTRAINT classroom_polls_teacher_id_fkey,
  ADD CONSTRAINT classroom_polls_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;

ALTER TABLE hpc_records DROP CONSTRAINT hpc_records_teacher_id_fkey,
  ADD CONSTRAINT hpc_records_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;

ALTER TABLE teacher_analytics_cache DROP CONSTRAINT teacher_analytics_cache_teacher_id_fkey,
  ADD CONSTRAINT teacher_analytics_cache_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE;

ALTER TABLE teacher_student_notes DROP CONSTRAINT teacher_student_notes_teacher_id_fkey,
  ADD CONSTRAINT teacher_student_notes_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;

COMMIT;
