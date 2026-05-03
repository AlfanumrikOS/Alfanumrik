-- Migration: 20260425130000_first_domain_event_publication.sql
-- Phase 0d.3: first domain event publication (proves outbox end-to-end)
-- Per docs/architecture/EVENT_CATALOG.md and Phase 0d.1 outbox foundation
-- (20260425120000_domain_events_outbox.sql).
-- Owner: B6 (content). Producer-only — no consumers exist yet.
--
-- Purpose:
--   Wire the FIRST domain event publication using the `enqueue_event` RPC
--   shipped in Phase 0d.1. We pick `content.request_submitted` because it
--   is the lowest-risk eligible publisher:
--     1. B6-owned table (`public.content_requests`) — no cross-context
--        coupling.
--     2. Zero existing consumers — a non-firing event causes no failure
--        cascade anywhere downstream.
--     3. Trigger-based wiring — zero application code changes; the AFTER
--        INSERT trigger writes to the outbox in the same transaction as
--        the originating insert, satisfying the outbox guarantee.
--     4. Does not touch quiz, payment, auth, or onboarding flows
--        (P1 / P4 / P11 / P15 sacred).
--
--   The catalog (EVENT_CATALOG.md) lists E1 (`quiz.completed`) and E2
--   (`payment.completed`) as the highest-value events, but both touch
--   sacred invariants and have synchronous consumers we are not ready
--   to migrate. Shipping `content.request_submitted` first proves the
--   outbox plumbing without any blast-radius risk; once the polling
--   worker (Phase 1) lands, higher-risk producers can be wired one at
--   a time with confidence the path works.
--
-- Scope of this phase:
--   - Migration-only. AFTER INSERT trigger on content_requests.
--   - No application code calls enqueue_event directly.
--   - No queue-consumer Edge Function (deferred to Phase 1).
--
-- Safety:
--   - Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
--   - SECURITY DEFINER on the trigger function so producers (students
--     inserting their own request via RLS) can publish to the outbox
--     without needing direct INSERT privileges on domain_events. The
--     outbox enqueue_event RPC is itself SECDEF + service-role-only.
--   - search_path pinned to `public` (project convention; see
--     20260408000009).
--   - **Non-blocking:** the trigger function swallows ALL exceptions
--     from enqueue_event and RETURNs NEW so an outbox-write failure
--     does NOT roll back the originating INSERT. We accept event loss
--     over write loss for content_requests — these are user-facing
--     primary writes (a student tapping "request this chapter"), and
--     a missed event is recoverable (analytics gap), whereas a lost
--     write is not (user thinks request landed, but it did not).
--   - P5 compliance: grade column is already TEXT in content_requests
--     (no cast needed); we still .::text the chapter_number when
--     stringifying it for any future grade-shaped consumers.
--
-- Verification of source columns (read from the table's defining
-- migration 20260418100400_feedback_and_failures.sql):
--   id              uuid
--   student_id      uuid (nullable; no NOT NULL constraint)
--   grade           text  (already P5-compliant)
--   subject_code    text
--   chapter_number  int
--   chapter_title   text  (nullable)
--   request_source  text  (CHECK in {foxy,quiz,learn,ncert-solver})
--   created_at      timestamptz

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Trigger function: emit content.request_submitted on INSERT
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_emit_content_request_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_event(
    'content.request_submitted',
    'content_request',
    NEW.id,
    jsonb_build_object(
      'request_id',     NEW.id,
      'student_id',     NEW.student_id,
      'grade',          NEW.grade,                -- already TEXT (P5)
      'subject_code',   NEW.subject_code,
      'chapter_number', NEW.chapter_number,
      'chapter_title',  NEW.chapter_title,
      'request_source', NEW.request_source,
      'created_at',     NEW.created_at
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- ────────────────────────────────────────────────────────────
  -- Outbox failure must NOT block the originating insert.
  -- ────────────────────────────────────────────────────────────
  -- Trade-off: we prefer event loss over write loss. The user-facing
  -- contract is "your content request was recorded" — losing the
  -- analytics-grade outbox event is recoverable (re-emit via backfill);
  -- losing the underlying content_requests row is not (user has no
  -- visibility into the failure). RAISE WARNING surfaces the failure
  -- to PostgreSQL logs for ops follow-up without aborting the txn.
  RAISE WARNING 'enqueue_event failed for content_request %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_emit_content_request_submitted() IS
  'AFTER INSERT trigger on public.content_requests: emits content.request_submitted to the outbox via enqueue_event. Non-blocking — swallows all exceptions to keep the originating insert atomic. See migration 20260425130000_first_domain_event_publication.sql.';

REVOKE EXECUTE ON FUNCTION public.tg_emit_content_request_submitted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_emit_content_request_submitted() TO service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Trigger wiring (idempotent)
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_content_request_submitted ON public.content_requests;
CREATE TRIGGER trg_content_request_submitted
  AFTER INSERT ON public.content_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_emit_content_request_submitted();

COMMENT ON TRIGGER trg_content_request_submitted ON public.content_requests IS
  'Phase 0d.3: emits content.request_submitted to the domain_events outbox after each insert. Non-blocking on outbox failure.';

COMMIT;
