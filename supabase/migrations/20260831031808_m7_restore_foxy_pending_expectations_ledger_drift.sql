-- M7 (schema review finding): public.foxy_pending_expectations, its cron
-- function, and its feature-flag seed were recorded as successfully applied
-- in supabase_migrations.schema_migrations by migration 20260528000013 (whose
-- own verification block RAISE EXCEPTIONs on failed creation, so the object
-- WAS created at apply time) but do not exist in production today. No DROP
-- TABLE/FUNCTION for these objects appears anywhere in this repo's migration
-- history, no test or doc flags them as a deliberate removal, and the app
-- code that reads/writes this table (packages/lib/src/learn/foxy-expectations.ts,
-- apps/host/src/app/api/foxy/route.ts) is still live and gated behind
-- ff_foxy_pending_expectations_v1 — which is ALSO missing, not merely OFF.
--
-- This migration restores exact parity with the ledger's claim, re-running
-- 20260528000013 verbatim (it was written idempotent/safe-to-rerun) plus the
-- 20260619000900 CHECK-widening that followed it. It does NOT reactivate
-- anything: the flag is re-seeded at is_enabled=false / rollout_percentage=0,
-- identical to its original default, so the ANSWERING_NOW continuity feature
-- stays exactly as inert as it was believed to be before this gap was found.

-- ── from 20260528000013 ──
CREATE TABLE IF NOT EXISTS public.foxy_pending_expectations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid NOT NULL REFERENCES public.foxy_sessions(id) ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  expectation_kind     text NOT NULL CHECK (expectation_kind IN ('mcq','open','recall','solve','explain','choose_topic')),
  expectation_text     text NOT NULL,
  expectation_meta     jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject              text NOT NULL,
  grade                text NOT NULL,
  chapter              text,
  topic_id             uuid REFERENCES public.curriculum_topics(id) ON DELETE SET NULL,
  bloom_level          text,
  difficulty           text,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','abandoned','expired')),
  answered_at          timestamptz,
  answered_message_id  uuid REFERENCES public.foxy_chat_messages(id) ON DELETE SET NULL,
  asked_message_id     uuid REFERENCES public.foxy_chat_messages(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS foxy_pending_expectations_session_open_idx
  ON public.foxy_pending_expectations (session_id, status)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS foxy_pending_expectations_student_idx
  ON public.foxy_pending_expectations (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS foxy_pending_expectations_expires_idx
  ON public.foxy_pending_expectations (expires_at)
  WHERE status = 'open';

ALTER TABLE public.foxy_pending_expectations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS foxy_pending_expectations_student_read ON public.foxy_pending_expectations;
CREATE POLICY foxy_pending_expectations_student_read ON public.foxy_pending_expectations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = student_id AND s.auth_user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.foxy_pending_expectations IS
  'Phase 3 of Foxy continuity fix (2026-05-18): server-side state for "Foxy asked X, expect answer to X." Read by /api/foxy on next turn, injected as ANSWERING_NOW prompt block. Writes are service-role-only via /api/foxy/route.ts. Flag-gated by ff_foxy_pending_expectations_v1 (default OFF). RESTORED 2026-08-31 after being found missing despite an applied-migration ledger record (M7, schema review) — see docs/audit/launch-readiness/28-m1-m10-and-h1-h4-remediation.md.';

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

INSERT INTO public.feature_flags (
  flag_name, is_enabled, rollout_percentage, description, target_roles, target_environments, created_at, updated_at
)
VALUES (
  'ff_foxy_pending_expectations_v1', false, 0,
  'Phase 3 Foxy continuity: extract questions from Foxy assistant replies, persist to foxy_pending_expectations, inject the open expectation as ANSWERING_NOW prompt block on the next student turn. OFF = no expectation tracking; turn coherence relies on history alone.',
  ARRAY[]::TEXT[], ARRAY['staging', 'production']::TEXT[], now(), now()
)
ON CONFLICT (flag_name) DO NOTHING;

-- ── from 20260619000900 ──
ALTER TABLE public.foxy_pending_expectations
  DROP CONSTRAINT IF EXISTS foxy_pending_expectations_expectation_kind_check;
ALTER TABLE public.foxy_pending_expectations
  ADD CONSTRAINT foxy_pending_expectations_expectation_kind_check
  CHECK (expectation_kind IN ('mcq','open','recall','solve','explain','choose_topic','next_topic'));

-- ── verification ──
DO $$
BEGIN
  IF to_regclass('public.foxy_pending_expectations') IS NULL THEN
    RAISE EXCEPTION 'M7 restoration failed: table still absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='expire_stale_foxy_expectations') THEN
    RAISE EXCEPTION 'M7 restoration failed: cron function still absent';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_name='ff_foxy_pending_expectations_v1' AND is_enabled = true) THEN
    RAISE EXCEPTION 'M7 restoration failed: flag came back enabled, not OFF as intended';
  END IF;
END $$;
