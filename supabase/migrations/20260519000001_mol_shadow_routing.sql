-- 20260519000001_mol_shadow_routing.sql
-- C4 foundation: extend mol_request_logs to support shadow routing rows.
--
-- Background:
--   C3 (PR #853 + #854) shipped telemetry-only logging: every grounded-answer
--   callClaude() invocation shadow-writes a row into mol_request_logs without
--   touching the user-facing request. C4 takes the next step — fire a second,
--   parallel OpenAI call for every grounded-answer LLM request (the shadow),
--   discard the response (the baseline Anthropic answer still serves the
--   student), and persist BOTH legs so an offline grader can compare quality.
--
-- This migration lands ONLY the schema substrate. The actual fire-and-forget
-- helper is supabase/functions/grounded-answer/mol-shadow.ts; the wire-up to
-- pipeline.ts / pipeline-stream.ts and the grader cron arrive in C4.2.
--
-- What changes here:
--   1. Five shadow-specific columns on mol_request_logs:
--        shadow_of_request_id  — JOIN key from shadow row → baseline row
--        shadow_role           — 'baseline' | 'shadow' | NULL (legacy rows)
--        shadow_grader_score   — written by the grader cron (C4.2)
--        shadow_grader_payload — grader rubric + reasoning, written by cron
--        shadow_graded_at      — grader completion timestamp
--   2. A trace_id column for cross-service correlation with the existing
--      grounded_ai_traces table. NULL for direct MOL callers; populated by
--      C4.2 wire-up for every grounded-answer-originated MOL row.
--   3. Three partial indexes: pair-lookup, role+time, and trace lookup.
--   4. A view (mol_shadow_pairs_v1) that JOINs baseline ↔ shadow rows by
--      request_id, for analyst convenience.
--
-- All existing rows survive: every new column is NULLABLE. The view inherits
-- mol_request_logs' admin-read RLS policy through SECURITY INVOKER (Postgres
-- views default).

ALTER TABLE public.mol_request_logs
  ADD COLUMN IF NOT EXISTS shadow_of_request_id text NULL,
  ADD COLUMN IF NOT EXISTS shadow_role text NULL,
  ADD COLUMN IF NOT EXISTS shadow_grader_score numeric(4,3) NULL,
  ADD COLUMN IF NOT EXISTS shadow_grader_payload jsonb NULL,
  ADD COLUMN IF NOT EXISTS shadow_graded_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS trace_id text NULL;

-- CHECK constraints are NOT idempotent under bare `ADD CONSTRAINT`; wrap so
-- the migration is re-runnable on an environment that already has the column
-- but not yet the constraint (e.g. a manual hot-fix patch).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'mol_request_logs_shadow_role_check'
       AND conrelid = 'public.mol_request_logs'::regclass
  ) THEN
    ALTER TABLE public.mol_request_logs
      ADD CONSTRAINT mol_request_logs_shadow_role_check
      CHECK (shadow_role IS NULL OR shadow_role IN ('baseline', 'shadow'));
  END IF;
END $$;

-- Indexes: all three are partial so they cost nothing for the (vast majority
-- of) non-shadow rows that legacy callers and direct MOL clients write.

-- Pair lookup: given a baseline.request_id, find the shadow row(s).
CREATE INDEX IF NOT EXISTS mol_request_logs_shadow_pair_idx
  ON public.mol_request_logs (shadow_of_request_id)
  WHERE shadow_of_request_id IS NOT NULL;

-- Role + time: dashboards listing recent baseline-vs-shadow rows.
CREATE INDEX IF NOT EXISTS mol_request_logs_shadow_role_idx
  ON public.mol_request_logs (shadow_role, created_at DESC)
  WHERE shadow_role IS NOT NULL;

-- Trace lookup: cross-service correlation with grounded_ai_traces.id.
CREATE INDEX IF NOT EXISTS mol_request_logs_trace_id_idx
  ON public.mol_request_logs (trace_id)
  WHERE trace_id IS NOT NULL;

-- View: pair baseline (Anthropic, served-to-user) with shadow (OpenAI,
-- discarded) rows by request_id. The shadow row carries
-- shadow_of_request_id = baseline.request_id; the JOIN uses that link.
--
-- Returns one row per baseline-shadow pair. Baselines without a shadow row
-- (e.g. flag-off task_types, sample misses) are excluded by the inner join —
-- analysts wanting unpaired baselines should query mol_request_logs directly.
CREATE OR REPLACE VIEW public.mol_shadow_pairs_v1 AS
SELECT
  b.request_id,
  b.trace_id,
  b.task_type,
  b.surface,
  b.created_at,
  b.provider     AS baseline_provider,
  b.model        AS baseline_model,
  b.latency_ms   AS baseline_latency_ms,
  b.inr_cost     AS baseline_inr_cost,
  s.provider     AS shadow_provider,
  s.model        AS shadow_model,
  s.latency_ms   AS shadow_latency_ms,
  s.inr_cost     AS shadow_inr_cost,
  s.shadow_grader_score,
  s.shadow_grader_payload
FROM public.mol_request_logs b
JOIN public.mol_request_logs s
  ON s.shadow_of_request_id = b.request_id
 AND s.shadow_role = 'shadow'
WHERE b.shadow_role = 'baseline';

GRANT SELECT ON public.mol_shadow_pairs_v1 TO authenticated;

-- Comments for self-documentation. Read by the marking-audit/runbook
-- generators that scan information_schema.
COMMENT ON COLUMN public.mol_request_logs.shadow_of_request_id IS
  'When this row is a shadow leg, the baseline leg''s request_id. NULL otherwise. JOIN key for baseline↔shadow pairs.';

COMMENT ON COLUMN public.mol_request_logs.shadow_role IS
  '''baseline'' = served the user; ''shadow'' = parallel discard for grader; NULL = legacy / non-shadow MOL row.';

COMMENT ON COLUMN public.mol_request_logs.shadow_grader_score IS
  'C4.2: 0.000–1.000 quality score written asynchronously by the Sonnet grader cron. NULL until grading completes.';

COMMENT ON COLUMN public.mol_request_logs.shadow_grader_payload IS
  'C4.2: grader rubric breakdown + reasoning. JSON shape stabilized when the grader ships.';

COMMENT ON COLUMN public.mol_request_logs.shadow_graded_at IS
  'C4.2: timestamp when the grader cron wrote shadow_grader_score / shadow_grader_payload.';

COMMENT ON COLUMN public.mol_request_logs.trace_id IS
  'grounded_ai_traces.id when this MOL call originated from grounded-answer. NULL for direct MOL callers. Cross-service correlation key.';

COMMENT ON VIEW public.mol_shadow_pairs_v1 IS
  'Pairs baseline (Anthropic, served-to-user) with shadow (OpenAI, discarded) rows for offline quality comparison. Used by C4 shadow-routing analysis.';
