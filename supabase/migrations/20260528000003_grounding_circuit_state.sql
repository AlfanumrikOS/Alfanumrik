-- ============================================================================
-- Migration: 20260528000003_grounding_circuit_state.sql
-- Phase F.5 (Super-Admin Production-Readiness Plan, 2026-05-17)
--
-- Purpose: Add a `circuit_state` column to grounded_ai_traces so the
-- /super-admin/grounding/health page can stop returning an empty
-- `circuitStates: {}` (which was tied to a TODO and never populated).
--
-- The column is nullable so existing rows keep working untouched. The
-- grounded-answer Edge Function will be updated separately to write the
-- current circuit state on each trace it emits; until that lands the route
-- will report state='pending_instrumentation' for the circuit chart.
-- ============================================================================

ALTER TABLE grounded_ai_traces
  ADD COLUMN IF NOT EXISTS circuit_state TEXT NULL,
  ADD COLUMN IF NOT EXISTS circuit_caller TEXT NULL;

-- Enum-ish check: keep it permissive so the Edge Function can add new
-- breakers without a schema bump.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'grounded_ai_traces_circuit_state_check'
      AND conrelid = 'grounded_ai_traces'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE grounded_ai_traces DROP CONSTRAINT grounded_ai_traces_circuit_state_check';
  END IF;
END $$;

ALTER TABLE grounded_ai_traces
  ADD CONSTRAINT grounded_ai_traces_circuit_state_check
  CHECK (circuit_state IS NULL OR circuit_state IN ('closed', 'open', 'half_open'));

-- Index for the per-circuit count query that the route runs against the last
-- hour of data. Partial: only rows that have the column populated participate.
CREATE INDEX IF NOT EXISTS idx_grounded_ai_traces_circuit_recent
  ON grounded_ai_traces(circuit_caller, circuit_state, created_at DESC)
  WHERE circuit_state IS NOT NULL;

COMMENT ON COLUMN grounded_ai_traces.circuit_state IS
  'Current circuit-breaker state at the time the trace was emitted. NULL '
  'until the grounded-answer Edge Function is updated to write it (Phase F.5 '
  'route reports state=pending_instrumentation while NULL dominates).';

COMMENT ON COLUMN grounded_ai_traces.circuit_caller IS
  'Name of the breaker (e.g. ''voyage'', ''claude''). Matches caller column on '
  'aggregation. NULL until Edge Function update.';
