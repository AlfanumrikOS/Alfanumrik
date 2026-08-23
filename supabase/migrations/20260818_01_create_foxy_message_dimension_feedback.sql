-- 20260818_01_create_foxy_message_dimension_feedback.sql
-- Phase A.2: dimension-level Foxy feedback. Extends the existing
-- foxy_message_feedback (binary thumbs) with per-dimension is_up booleans
-- so a reward model (Phase C) can separate accuracy from clarity from
-- helpfulness from CBSE-scope signal.
--
-- P5/P13: dimension is a closed enum only — no free-text topic capture.
-- reason is optional free-text about the answer (PII-free by construction).
-- No new PII columns. Same ownership/RLS posture as foxy_message_feedback.
--
-- Assessment review required before finalizing the dimension set — see
-- .hermes/plans/2026-08-18_plan-rlhf-in-alfanumrik.md §Phase A.2.

BEGIN;

-- ── 1. CREATE TABLE foxy_message_dimension_feedback ──────────────────────
CREATE TABLE IF NOT EXISTS public.foxy_message_dimension_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES public.foxy_chat_messages(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES public.foxy_sessions(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  dimension    text NOT NULL CHECK (
    dimension IN ('accuracy', 'clarity', 'helpfulness', 'scope')
  ),
  is_up        boolean NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One feedback row per (student, message, dimension). UPSERT semantics
  -- let a student flip 👍 → 👎 on a dimension without duplicates.
  UNIQUE (message_id, student_id, dimension)
);

COMMENT ON TABLE public.foxy_message_dimension_feedback IS
  'Phase A.2: per-message, per-dimension Foxy feedback. Extends binary thumbs '
  'with separable accuracy/clarity/helpfulness/scope signals for reward-model '
  'training (Phase C). Allowed dimensions are a closed enum — assessment-reviewed.';

COMMENT ON COLUMN public.foxy_message_dimension_feedback.dimension IS
  'Closed enum: accuracy | clarity | helpfulness | scope. Assessment-reviewed set — '
  'do not add values without assessment sign-off.';

-- Why no age-appropriateness dimension here (assessment review note, 2026-08-23):
-- age-appropriateness is already measured automatically, nightly, by the
-- Sonnet-as-judge pipeline — see foxy_quality_scores.age_appropriateness_score
-- (supabase/migrations/20260508240000_foxy_quality_scores.sql:41). Asking a
-- grade 6-12 student to self-report "was this age-appropriate for me" is not
-- a meaningful signal the way accuracy/clarity/helpfulness/scope are (a
-- student is not well positioned to judge age-appropriateness of content
-- aimed at their own age group), whereas the automated judge is a more
-- reliable mechanism for that specific dimension. This is intentional
-- scoping, not an oversight — do not add an age-appropriateness value to
-- this student-facing enum without a fresh assessment sign-off.

-- ── 2. INDEXES ────────────────────────────────────────────────────────────

-- Read path: recent dimension feedback for a student (dashboard + analytics).
CREATE INDEX IF NOT EXISTS idx_foxy_dim_feedback_student_recent
  ON public.foxy_message_dimension_feedback (student_id, created_at DESC);

-- Read path: dimension feedback for a session.
CREATE INDEX IF NOT EXISTS idx_foxy_dim_feedback_session
  ON public.foxy_message_dimension_feedback (session_id, created_at DESC);

-- Read path: per-dimension aggregates (reward-model feature prep).
CREATE INDEX IF NOT EXISTS idx_foxy_dim_feedback_dimension
  ON public.foxy_message_dimension_feedback (dimension);

-- ── 3. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.foxy_message_dimension_feedback ENABLE ROW LEVEL SECURITY;

-- Read: a student can read their own dimension feedback. Service role bypasses.
DROP POLICY IF EXISTS foxy_dim_feedback_read_self ON public.foxy_message_dimension_feedback;
CREATE POLICY foxy_dim_feedback_read_self ON public.foxy_message_dimension_feedback
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
  );

-- Write: service-role only (the API route validates ownership before insert).
-- Direct authenticated writes are blocked because we need the server-side
-- ownership check + message role validation.
DROP POLICY IF EXISTS foxy_dim_feedback_write_service ON public.foxy_message_dimension_feedback;
CREATE POLICY foxy_dim_feedback_write_service ON public.foxy_message_dimension_feedback
  FOR ALL USING (auth.role() = 'service_role');

-- ── 4. RPC: record_message_dimension_feedback ────────────────────────────
-- Single entry point for /api/foxy/feedback/dimension. Mirrors
-- record_message_feedback() posture: auth.uid() guard so a student cannot
-- feedback another student's message, UPSERT on (message_id, student_id,
-- dimension), returns the row id + coach_mode_used for client UX.
--
-- Called via supabaseAdmin (service-role JWT) from the API route, so
-- auth.uid() is NULL inside the function — the route MUST do the ownership
-- check. The auth.uid() guard here is a secondary defense for any direct
-- authenticated caller.

CREATE OR REPLACE FUNCTION public.record_message_dimension_feedback(
  p_message_id   uuid,
  p_dimension    text,
  p_is_up        boolean,
  p_reason       text DEFAULT NULL
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
  v_student_id   uuid;
  v_session_id   uuid;
  v_coach_mode  text;
  v_role        text;
BEGIN
  SELECT m.student_id, m.session_id, m.coach_mode_used, m.role
  INTO v_student_id, v_session_id, v_coach_mode, v_role
  FROM public.foxy_chat_messages m
  WHERE m.id = p_message_id
  LIMIT 1;

  IF v_student_id IS NULL THEN
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
      RETURN;
    END IF;
  END IF;

  -- Validate dimension is in the allowed set (defence-in-depth; CHECK
  -- constraint on the table is the primary guard).
  IF p_dimension NOT IN ('accuracy', 'clarity', 'helpfulness', 'scope') THEN
    RETURN;
  END IF;

  -- UPSERT feedback. UNIQUE(message_id, student_id, dimension) makes this
  -- idempotent — a student flipping 👍 → 👎 on the same dimension updates
  -- the existing row rather than creating a new one.
  INSERT INTO public.foxy_message_dimension_feedback
    (message_id, session_id, student_id, dimension, is_up, reason)
  VALUES
    (p_message_id, v_session_id, v_student_id, p_dimension, p_is_up, p_reason)
  ON CONFLICT (message_id, student_id, dimension) DO UPDATE
    SET is_up  = EXCLUDED.is_up,
        reason = COALESCE(EXCLUDED.reason, public.foxy_message_dimension_feedback.reason),
        created_at = now();

  RETURN QUERY
  SELECT f.id, v_coach_mode
  FROM public.foxy_message_dimension_feedback f
  WHERE f.message_id = p_message_id
    AND f.student_id = v_student_id
    AND f.dimension  = p_dimension
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_message_dimension_feedback(uuid, text, boolean, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_message_dimension_feedback(uuid, text, boolean, text) IS
  'Phase A.2: record per-message, per-dimension Foxy feedback. Mirrors '
  'record_message_feedback() posture (auth.uid() guard + UPSERT). Called via '
  'supabaseAdmin from /api/foxy/feedback/dimension; auth.uid() is NULL in that '
  'flow so the route does the ownership check.';

COMMIT;
