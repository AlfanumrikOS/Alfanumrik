-- ─── B'-5 Phase 1: per-turn Foxy feedback persistence ──────────────────────
--
-- Pre-fix: the 👍/👎 buttons in the Foxy chat triggered `track_ai_quality(
-- subject, isUp)` which only bumped aggregate subject-level counters. There
-- was NO record of which message, session, or coach_mode the feedback
-- applied to — so we could never close the loop "this student responded
-- poorly to socratic mode, switch to answer mode for them".
--
-- This migration ships the data layer:
--   1. ALTER foxy_chat_messages ADD `coach_mode_used` so we know which
--      pedagogical mode produced each assistant message.
--   2. CREATE TABLE foxy_message_feedback to record per-message feedback
--      with FK to the message + student + session.
--   3. RPC record_message_feedback() that the API route calls — embeds an
--      auth.uid() guard so a student can only feedback their own messages.
--
-- Phase 2 (separate PR): wire the /foxy client to call /api/foxy/feedback
-- with messageId, and update resolveCoachMode to read recent feedback as a
-- mode-switch signal.
--
-- P5/P13: no PII columns added. coach_mode_used is an enum-like text;
-- feedback rows reference message_id only, no quote of the content.

BEGIN;

-- ── 1. ALTER foxy_chat_messages ───────────────────────────────────────────
ALTER TABLE public.foxy_chat_messages
  ADD COLUMN IF NOT EXISTS coach_mode_used text;

COMMENT ON COLUMN public.foxy_chat_messages.coach_mode_used IS
  'B''-5: which CoachMode (socratic|answer|review) produced this assistant '
  'message. Populated server-side at insert time by /api/foxy. NULL on legacy '
  'rows and on user messages.';

-- Allowed values (free-form to keep schema flexible if new modes are added)
ALTER TABLE public.foxy_chat_messages
  DROP CONSTRAINT IF EXISTS chk_foxy_chat_coach_mode;
ALTER TABLE public.foxy_chat_messages
  ADD CONSTRAINT chk_foxy_chat_coach_mode
  CHECK (
    coach_mode_used IS NULL
    OR coach_mode_used IN ('socratic', 'answer', 'review')
  );

-- ── 2. CREATE TABLE foxy_message_feedback ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.foxy_message_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES public.foxy_chat_messages(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES public.foxy_sessions(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  is_up        boolean NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One feedback row per (student, message). UPSERT semantics from the API
  -- let a student flip 👍 → 👎 without creating duplicate rows.
  UNIQUE (message_id, student_id)
);

COMMENT ON TABLE public.foxy_message_feedback IS
  'B''-5: per-message Foxy feedback. Replaces the aggregate-only '
  'track_ai_quality counter. Used by resolveCoachMode (Phase 2) to switch '
  'mode for students whose recent messages got mostly 👎.';

-- Read path: "recent feedback for this student" lookup ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_foxy_message_feedback_student_recent
  ON public.foxy_message_feedback (student_id, created_at DESC);

-- Read path: feedback for a session (analytics + super-admin grounding panel).
CREATE INDEX IF NOT EXISTS idx_foxy_message_feedback_session
  ON public.foxy_message_feedback (session_id, created_at DESC);

-- ── 3. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.foxy_message_feedback ENABLE ROW LEVEL SECURITY;

-- Read: a student can read their own feedback. Service role bypasses.
DROP POLICY IF EXISTS foxy_message_feedback_read_self ON public.foxy_message_feedback;
CREATE POLICY foxy_message_feedback_read_self ON public.foxy_message_feedback
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
  );

-- Write: service-role only (the API route validates ownership before insert).
-- Direct authenticated writes are blocked because we need the server-side
-- coach_mode_used lookup + ownership check.
DROP POLICY IF EXISTS foxy_message_feedback_write_service ON public.foxy_message_feedback;
CREATE POLICY foxy_message_feedback_write_service ON public.foxy_message_feedback
  FOR ALL USING (auth.role() = 'service_role');

-- ── 4. RPC: record_message_feedback ───────────────────────────────────────
-- Single entry point for /api/foxy/feedback. Embeds the auth.uid() guard so
-- a student cannot feedback another student's message even if the API route
-- is called with a forged message_id. Returns the id of the inserted/
-- updated row + the resolved coach_mode_used (so the client can show
-- "thanks — we'll try a different style next time" UX).

CREATE OR REPLACE FUNCTION public.record_message_feedback(
  p_message_id uuid,
  p_is_up      boolean,
  p_reason     text DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  coach_mode_used text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_student_id     uuid;
  v_session_id     uuid;
  v_coach_mode     text;
  v_role           text;
BEGIN
  -- Resolve student_id from auth.uid(). Service-role callers must pass
  -- p_message_id and the row's student_id is trusted (no auth.uid()).
  -- For authenticated student callers, we cross-check against the message.
  SELECT m.student_id, m.session_id, m.coach_mode_used, m.role
  INTO v_student_id, v_session_id, v_coach_mode, v_role
  FROM public.foxy_chat_messages m
  WHERE m.id = p_message_id
  LIMIT 1;

  IF v_student_id IS NULL THEN
    -- Message not found
    RETURN;
  END IF;

  -- Only assistant messages can receive feedback.
  IF v_role <> 'assistant' THEN
    RETURN;
  END IF;

  -- Authenticated callers must be the message's owner.
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = v_student_id AND s.auth_user_id = auth.uid()
    ) THEN
      RETURN; -- empty resultset; auth.uid() didn't match
    END IF;
  END IF;

  -- UPSERT feedback. UNIQUE(message_id, student_id) makes this idempotent.
  INSERT INTO public.foxy_message_feedback (message_id, session_id, student_id, is_up, reason)
  VALUES (p_message_id, v_session_id, v_student_id, p_is_up, p_reason)
  ON CONFLICT (message_id, student_id) DO UPDATE
    SET is_up = EXCLUDED.is_up,
        reason = COALESCE(EXCLUDED.reason, public.foxy_message_feedback.reason),
        created_at = now();

  RETURN QUERY
  SELECT f.id, v_coach_mode
  FROM public.foxy_message_feedback f
  WHERE f.message_id = p_message_id AND f.student_id = v_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_message_feedback(uuid, boolean, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_message_feedback(uuid, boolean, text) IS
  'B''-5 Phase 1: record per-message feedback with auth.uid() ownership '
  'guard. UPSERT-safe (a student can flip 👍 → 👎 without creating duplicate '
  'rows). Returns the feedback row id + coach_mode_used so the API can echo '
  'it back to the client.';

COMMIT;
