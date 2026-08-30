-- Reconstructed from production ledger (supabase_migrations.schema_migrations).
-- Originally applied out-of-band 2026-08-29; committed to restore parity.
-- Content verified byte-identical to stored statements. Do not re-run
-- against production — already applied at version 20260829163756.

CREATE INDEX IF NOT EXISTS idx_concept_attempts_student_time
  ON public.concept_attempts (student_id, answered_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ncert_attempts_student_time
  ON public.student_ncert_attempts (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assignment_subs_student_time
  ON public.assignment_submissions (student_id, submitted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_bookmarks_student_time
  ON public.student_bookmarks (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_achievements_student_time
  ON public.student_achievements (student_id, unlocked_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_challenge_attempts_student_time
  ON public.challenge_attempts (student_id, attempted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chapter_progress_student_time
  ON public.chapter_progress (student_id, last_activity_at DESC NULLS LAST);