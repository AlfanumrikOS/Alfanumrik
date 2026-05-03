-- Migration: 20260427000200_irt_calibration_columns.sql
-- Purpose: Phase 4 of Foxy moat plan — add 2-parameter logistic IRT calibration
--          columns to question_bank and stub the recalibration RPC so cron
--          infrastructure can be wired ahead of the real implementation.
--
-- The existing irt_difficulty column (added in 20260408000007) stays as the
-- proxy fallback. Selectors should consult (irt_a, irt_b) only when
-- irt_calibration_n >= 30; otherwise use the proxy.
--
-- Idempotent: ALTER TABLE wrapped in EXCEPTION guards; CREATE OR REPLACE for fn.

-- ============================================================================
-- 1. Add 2PL IRT calibration columns to question_bank
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN irt_a NUMERIC(5,3);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN irt_b NUMERIC(5,3);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN irt_calibration_n INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN irt_calibrated_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

COMMENT ON COLUMN question_bank.irt_a IS
  '2PL IRT discrimination parameter. NULL until calibrated. Selectors should '
  'consult this only when irt_calibration_n >= 30; below that, fall back to '
  'the irt_difficulty proxy (see migration 20260408000007).';
COMMENT ON COLUMN question_bank.irt_b IS
  '2PL IRT difficulty parameter (theta scale). NULL until calibrated. Same '
  'fallback rule as irt_a.';
COMMENT ON COLUMN question_bank.irt_calibration_n IS
  'Number of student responses included in the most recent calibration fit. '
  'Selectors gate on >= 30 before trusting (irt_a, irt_b).';
COMMENT ON COLUMN question_bank.irt_calibrated_at IS
  'Timestamp of last successful 2PL fit. NULL means never calibrated.';

-- ============================================================================
-- 2. Index to find questions due for recalibration efficiently
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_question_bank_irt_recalibration
  ON question_bank(irt_calibrated_at NULLS FIRST)
  WHERE is_active = true;

COMMENT ON INDEX idx_question_bank_irt_recalibration IS
  'Supports nightly calibration cron sweeping oldest-first. Foxy moat Phase 4.';

-- ============================================================================
-- 3. Stub recalibration RPC
-- ============================================================================
-- SECURITY INVOKER: stub returns metadata only; real implementation will run
-- under a scheduled service-role context where RLS is bypassed naturally.
CREATE OR REPLACE FUNCTION recalibrate_question_irt_2pl(
  p_question_id UUID DEFAULT NULL,
  p_min_attempts INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Phase 4 stub. The real implementation is deferred to the ops sprint.
  --
  -- Intended behaviour (when implemented):
  --   1. For each question in question_bank with is_active = true and
  --      attempt_count >= p_min_attempts (or the single question identified
  --      by p_question_id), gather (student_theta, response_correct) pairs
  --      from user_question_history joined with student_skill_state.
  --   2. Fit a 2-parameter logistic model:
  --        P(correct | theta) = 1 / (1 + exp(-a * (theta - b)))
  --      via Newton-Raphson maximum-likelihood estimation, converging on
  --      (a, b) per question. Bound a in [0.3, 3.0] and b in [-4.0, 4.0]
  --      to reject pathological fits.
  --   3. Write irt_a, irt_b, irt_calibration_n, irt_calibrated_at = now().
  --   4. Return JSON summary {questions_fit, questions_skipped, errors[]}.
  --
  -- Until then, callers receive a structured "not implemented" payload so
  -- the cron wiring can be deployed without breaking.
  RETURN jsonb_build_object(
    'status', 'not_implemented',
    'message', 'Phase 4 implementation deferred to ops sprint',
    'requested_question_id', p_question_id,
    'min_attempts', p_min_attempts,
    'phase', 'foxy-moat-phase-4'
  );
END;
$$;

COMMENT ON FUNCTION recalibrate_question_irt_2pl(UUID, INT) IS
  'Stub for Phase 4 IRT calibration. Real implementation: Newton-Raphson 2PL '
  'fit per question with >= 30 attempts, writing (irt_a, irt_b, '
  'irt_calibration_n, irt_calibrated_at). Currently returns a not-implemented '
  'JSON payload so cron infrastructure can be wired ahead of the algorithm.';
