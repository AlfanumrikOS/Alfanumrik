-- Migration: 20260425140300_e8_practice_completed_event.sql
-- Phase 0e wiring (Wave 2) — emits E8 practice.completed when a learner
-- finishes a spaced-repetition card review.
--
-- Per docs/architecture/EVENT_CATALOG.md:
--   E8 practice.completed → fires when spaced_repetition_cards.last_review_date
--                            is updated, signalling SM-2 review just finished.
--
-- Anchor: AFTER UPDATE on spaced_repetition_cards WHEN
--   OLD.last_review_date IS DISTINCT FROM NEW.last_review_date AND
--   NEW.last_review_date IS NOT NULL.
--
-- Why last_review_date and not total_reviews++:
--   total_reviews increments on each SM-2 update, but the review-date
--   field is the canonical "this review just happened" signal. It only
--   gets touched when SM-2 evaluates a card; other UPDATEs (toggling
--   is_active, archiving) leave it alone — so we don't fire spurious
--   events.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_emit_practice_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire on a real review event.
  IF NEW.last_review_date IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.last_review_date IS NOT DISTINCT FROM NEW.last_review_date THEN
    -- last_review_date unchanged — must be some other UPDATE (archive, etc.).
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_event(
    'practice.completed',
    'spaced_repetition_card',
    NEW.id,
    jsonb_build_object(
      'card_id', NEW.id,
      'student_id', NEW.student_id,
      'subject', NEW.subject,
      'grade', NEW.grade::text,                  -- P5: ensure string
      'chapter_number', NEW.chapter_number,
      'topic', NEW.topic,
      'last_quality', NEW.last_quality,
      'ease_factor', NEW.ease_factor,
      'interval_days', NEW.interval_days,
      'repetition_count', NEW.repetition_count,
      'streak', NEW.streak,
      'reviewed_at', NEW.last_review_date::text
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Outbox failure must NOT block SM-2 review writes.
  RAISE WARNING 'enqueue_event failed for spaced_repetition_card %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_practice_completed ON public.spaced_repetition_cards;
CREATE TRIGGER trg_practice_completed
AFTER UPDATE ON public.spaced_repetition_cards
FOR EACH ROW
WHEN (OLD.last_review_date IS DISTINCT FROM NEW.last_review_date)
EXECUTE FUNCTION public.tg_emit_practice_completed();

REVOKE EXECUTE ON FUNCTION public.tg_emit_practice_completed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_emit_practice_completed() TO service_role;

COMMENT ON FUNCTION public.tg_emit_practice_completed() IS
  'Emits E8 practice.completed when spaced_repetition_cards.last_review_date is updated. Non-blocking: outbox failure cannot roll back the SM-2 review UPDATE.';

COMMIT;
