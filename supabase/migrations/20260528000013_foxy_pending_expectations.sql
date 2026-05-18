-- Migration: 20260528000013_foxy_pending_expectations.sql
-- Purpose: Phase 3 of Foxy continuity fix (2026-05-18). The moat.
--
-- "Structured education shall be saved in memory" — CEO directive.
--
-- This table records what question Foxy asked + what kind of answer is
-- expected. When the student replies, the BFF reads the most recent OPEN
-- expectation for the session and injects it into the prompt as an
-- ANSWERING_NOW block. The model can no longer "forget" what it just asked
-- because that intent is now first-class server state, not a heuristic
-- inferred from history text.
--
-- Phases 1 (silent session reset fix, PR #848) and 2 (native multi-turn
-- history) make the existing flow correct end-to-end; Phase 3 (this PR) is
-- the structural moat: even if either of those degrades, the open question
-- is anchored server-side and re-injected on the next turn.
--
-- Scope: ADD one new table + 3 indexes + 1 SECURITY DEFINER cron function +
-- 1 feature-flag seed. RLS enabled with student-own-read policy only —
-- writes happen exclusively via service_role from /api/foxy. No DROP. No
-- changes to canonical tables (foxy_sessions, foxy_chat_messages,
-- curriculum_topics, students).
--
-- Idempotency: CREATE TABLE / CREATE INDEX / CREATE POLICY / CREATE OR
-- REPLACE FUNCTION are all guarded with IF NOT EXISTS or DROP-then-create
-- where IF NOT EXISTS isn't supported on the clause. Safe to re-run.
--
-- Rollout: feature_flags row ff_foxy_pending_expectations_v1 ships OFF.
-- The route reads/writes the table only when the flag is enabled; OFF =
-- byte-identical legacy behavior (no extra reads, no extra writes).

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.foxy_pending_expectations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid NOT NULL REFERENCES public.foxy_sessions(id) ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  -- What kind of answer Foxy is expecting from the student.
  --   mcq           — multiple-choice ("which of the following...")
  --   open          — open-ended explanation
  --   recall        — fact/definition recall
  --   solve         — numeric/computational solve
  --   explain       — reasoning/why explanation
  --   choose_topic  — Foxy offered a menu; expecting a topic pick
  expectation_kind     text NOT NULL CHECK (expectation_kind IN ('mcq','open','recall','solve','explain','choose_topic')),

  -- The literal question text (or paraphrase) Foxy asked. Used verbatim in
  -- the ANSWERING_NOW prompt block. Truncated by the writer to <= 500 chars.
  expectation_text     text NOT NULL,

  -- Free-form metadata. For mcq: { options: ['A) ...','B) ...',...] }. For
  -- solve: { expected_units: 'm/s' }. For choose_topic: { offered: [...] }.
  -- Schema is intentionally loose — the prompt builder reads optional keys
  -- with safe fallbacks. JSONB so we can index/filter later if needed.
  expectation_meta     jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Pedagogy anchors. Mostly informational on this row but useful for
  -- future analytics ("Which Bloom level produced the highest answer rate?").
  subject              text NOT NULL,
  grade                text NOT NULL,  -- P5: grades are strings ('6'..'12'), never integers
  chapter              text,
  topic_id             uuid REFERENCES public.curriculum_topics(id) ON DELETE SET NULL,
  bloom_level          text,
  difficulty           text,

  -- Lifecycle.
  --   open       — Foxy asked; awaiting student reply
  --   answered   — student replied AND Foxy's next turn acknowledged the answer
  --   abandoned  — Foxy moved on to a new question without acknowledging
  --   expired    — 24h passed with no resolution (cron sweep)
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','abandoned','expired')),
  answered_at          timestamptz,
  answered_message_id  uuid REFERENCES public.foxy_chat_messages(id) ON DELETE SET NULL,
  asked_message_id     uuid REFERENCES public.foxy_chat_messages(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

-- The hottest read: "give me the most recent OPEN expectation for this
-- session." Partial index keeps it tiny — typical session has 0 or 1 open
-- row at any moment. Used by loadOpenExpectation() on every Foxy turn that
-- has the flag on.
CREATE INDEX IF NOT EXISTS foxy_pending_expectations_session_open_idx
  ON public.foxy_pending_expectations (session_id, status)
  WHERE status = 'open';

-- Per-student timeline. Used by future student-facing UI ("Foxy is waiting
-- on your answer to...") and by analytics queries.
CREATE INDEX IF NOT EXISTS foxy_pending_expectations_student_idx
  ON public.foxy_pending_expectations (student_id, created_at DESC);

-- Expiry sweeper index. Partial on status='open' so the cron scan stays
-- bounded even as the table grows.
CREATE INDEX IF NOT EXISTS foxy_pending_expectations_expires_idx
  ON public.foxy_pending_expectations (expires_at)
  WHERE status = 'open';

-- ============================================================================
-- 3. RLS (P8: every new table gets RLS in the same migration)
-- ============================================================================

ALTER TABLE public.foxy_pending_expectations ENABLE ROW LEVEL SECURITY;

-- Students may read their own open expectations. This is the only client-
-- visible policy; writes happen exclusively via service_role from
-- /api/foxy/route.ts (which bypasses RLS via supabase-admin.ts). There is
-- no INSERT / UPDATE / DELETE policy for anon/authenticated roles by design.
DROP POLICY IF EXISTS foxy_pending_expectations_student_read ON public.foxy_pending_expectations;
CREATE POLICY foxy_pending_expectations_student_read ON public.foxy_pending_expectations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = student_id AND s.auth_user_id = auth.uid()
    )
  );

-- Service-role write path is implicit: service_role bypasses RLS entirely,
-- so /api/foxy can INSERT/UPDATE freely without a permissive policy.

-- ============================================================================
-- 4. Comment (forensic + maintenance)
-- ============================================================================

COMMENT ON TABLE public.foxy_pending_expectations IS
  'Phase 3 of Foxy continuity fix (2026-05-18): server-side state for "Foxy asked X, expect answer to X." Read by /api/foxy on next turn, injected as ANSWERING_NOW prompt block. Writes are service-role-only via /api/foxy/route.ts. Flag-gated by ff_foxy_pending_expectations_v1 (default OFF).';

-- ============================================================================
-- 5. Cron sweeper function
-- ============================================================================
-- Called from supabase/functions/daily-cron/index.ts on the daily tick.
-- SECURITY DEFINER so it runs with table-owner privileges; EXECUTE is
-- granted only to service_role to keep callers tight.

CREATE OR REPLACE FUNCTION public.expire_stale_foxy_expectations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.foxy_pending_expectations
     SET status = 'expired'
   WHERE status = 'open'
     AND expires_at < now();
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_foxy_expectations() FROM public;
REVOKE ALL ON FUNCTION public.expire_stale_foxy_expectations() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_foxy_expectations() TO service_role;

COMMENT ON FUNCTION public.expire_stale_foxy_expectations() IS
  'Phase 3 of Foxy continuity fix: marks any "open" foxy_pending_expectations rows older than expires_at as "expired". Idempotent (no-op when nothing is stale). Called from daily-cron. SECURITY DEFINER with service_role-only EXECUTE.';

-- ============================================================================
-- 6. Feature-flag seed (default OFF)
-- ============================================================================

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  target_roles,
  target_environments,
  created_at,
  updated_at
)
VALUES (
  'ff_foxy_pending_expectations_v1',
  false,
  0,
  'Phase 3 Foxy continuity: extract questions from Foxy assistant replies, persist to foxy_pending_expectations, inject the open expectation as ANSWERING_NOW prompt block on the next student turn. OFF = no expectation tracking; turn coherence relies on history alone.',
  ARRAY[]::TEXT[],
  ARRAY['staging', 'production']::TEXT[],
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;

-- ============================================================================
-- 7. Verification block — deploy log confirms the seed
-- ============================================================================

DO $$
DECLARE
  v_table_exists boolean;
  v_fn_exists boolean;
  v_flag_enabled boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'foxy_pending_expectations'
  ) INTO v_table_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'expire_stale_foxy_expectations'
  ) INTO v_fn_exists;

  SELECT is_enabled INTO v_flag_enabled
    FROM public.feature_flags WHERE flag_name = 'ff_foxy_pending_expectations_v1';

  RAISE NOTICE '[foxy_pending_expectations] table_exists=% fn_exists=% flag_enabled=%',
    v_table_exists, v_fn_exists, COALESCE(v_flag_enabled::text, 'NULL');

  IF NOT v_table_exists THEN
    RAISE EXCEPTION '[foxy_pending_expectations] table creation failed';
  END IF;
  IF NOT v_fn_exists THEN
    RAISE EXCEPTION '[foxy_pending_expectations] cron function creation failed';
  END IF;
  IF v_flag_enabled IS TRUE THEN
    RAISE NOTICE '[foxy_pending_expectations] flag is currently ENABLED (pre-existing state preserved by ON CONFLICT DO NOTHING)';
  END IF;
END $$;
