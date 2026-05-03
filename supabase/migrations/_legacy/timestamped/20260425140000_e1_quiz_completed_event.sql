-- Migration: 20260425140000_e1_quiz_completed_event.sql
-- Phase 0d wiring (Wave 2) — emits E1 quiz.completed via AFTER INSERT
-- trigger on quiz_sessions when is_completed = true.
--
-- Per docs/architecture/EVENT_CATALOG.md, E1 is the canonical signal that
-- a learner finished a quiz. Producers downstream consume it for analytics
-- aggregation (B12) and notification dispatch (B11). The producer is
-- non-blocking: any failure to enqueue must NOT roll back the originating
-- atomic_quiz_profile_update transaction (P4 invariant).
--
-- Why a trigger and not a direct enqueue inside the RPC:
--   atomic_quiz_profile_update is P1/P4 sacred (score formula + atomic
--   submission). Modifying its function body would expand the surface
--   that touches sacred logic. A trigger lets us emit the event without
--   editing the RPC at all — and the EXCEPTION-WHEN-OTHERS handler keeps
--   the trigger non-blocking.
--
-- Anchor: AFTER INSERT on quiz_sessions WHERE NEW.is_completed = TRUE.
--   The current RPC inserts the row with is_completed = TRUE in a single
--   step (see 20260403500000_fix_submit_quiz_the_one_fix.sql line 242),
--   so AFTER INSERT is the right anchor. If a future RPC variant inserts
--   with is_completed = FALSE then later UPDATEs to TRUE, we'll need a
--   complementary AFTER UPDATE trigger — that's a known follow-up.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_emit_quiz_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when the row is being recorded as completed.
  IF NEW.is_completed IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_event(
    'quiz.completed',
    'quiz_session',
    NEW.id,
    jsonb_build_object(
      'session_id', NEW.id,
      'student_id', NEW.student_id,
      'subject', NEW.subject,
      'grade', NEW.grade::text,                  -- P5: ensure string
      'chapter_number', NEW.chapter_number,
      'topic_title', NEW.topic_title,
      'total_questions', NEW.total_questions,
      'correct_answers', NEW.correct_answers,
      'score_percent', NEW.score_percent,
      'time_taken_seconds', NEW.time_taken_seconds,
      'completed_at', COALESCE(NEW.completed_at, NEW.created_at)
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Outbox failure must NOT block the quiz submission. P4 atomicity is
  -- preserved by swallowing here. Consumers will pick up the next event.
  RAISE WARNING 'enqueue_event failed for quiz_session %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quiz_completed ON public.quiz_sessions;
CREATE TRIGGER trg_quiz_completed
AFTER INSERT ON public.quiz_sessions
FOR EACH ROW
EXECUTE FUNCTION public.tg_emit_quiz_completed();

REVOKE EXECUTE ON FUNCTION public.tg_emit_quiz_completed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_emit_quiz_completed() TO service_role;

COMMENT ON FUNCTION public.tg_emit_quiz_completed() IS
  'Emits E1 quiz.completed event when a quiz_sessions row is inserted with is_completed=TRUE. Non-blocking: outbox failure cannot roll back the originating atomic_quiz_profile_update transaction (P4).';

COMMIT;
