-- Migration: 20260722099000_irt_calibration_readiness_rpc.sql
-- Purpose: Master Action Plan Phase 4, Item 4.3 — read-only diagnostics RPC
--          answering "what fraction of the LIVE, frequently-served question
--          bank has actually crossed the IRT n>=30 calibration floor?".
--
-- Context: ff_irt_question_selection is deliberately, correctly OFF today
-- (per-item gate at irt_calibration_n >= 30 — see
-- packages/lib/src/irt/fisher-info.ts and the SQL RPC
-- select_questions_by_irt_info). The nightly cron /api/cron/irt-calibrate
-- calls recalibrate_question_irt_2pl(NULL, 30), which only stamps
-- irt_a/irt_b/irt_calibration_n onto question_bank when a fit actually
-- SUCCEEDS (n >= 30 AND correct_rate in (0.02, 0.98) AND theta variance
-- non-degenerate AND IRLS converges within 50 iterations). Rows that never
-- clear those gates keep irt_calibration_n at its prior value (default 0).
-- There was previously no visibility into what fraction of the actually-
-- served question bank has crossed the floor, so nobody could tell whether
-- flipping the flag would do anything meaningful yet.
--
-- Scope of "actively-served" here (is_active = true AND EXISTS at least one
-- quiz_responses row) reuses the two BASE filters recalibrate_question_irt_2pl
-- applies to every candidate question, so this function answers "of the
-- questions the calibrator could ever consider, how many have cleared the
-- floor" — not an abstract count over the whole catalog (which would include
-- drafts, retired items, and never-served questions that can never contribute
-- a meaningful calibration signal).
--
-- CORRECTION (verified against 20260703000200_irt_calibrator_theta_repoint.sql,
-- lines 97-107): this is NOT byte-identical to the calibrator's own candidate-
-- set predicate. The p_question_id IS NULL branch of
-- recalibrate_question_irt_2pl ALSO requires
--   (q.irt_calibrated_at IS NULL OR q.irt_calibrated_at < now() - interval '7 days')
-- — a rolling staleness gate that shrinks each night's batch to items due for
-- a refresh. That gate is deliberately DROPPED here: it answers "what should
-- tonight's run attempt", not "what is eligible for calibration at all". A
-- question recalibrated yesterday is still actively-served and calibrated;
-- reusing the staleness gate would incorrectly remove it from BOTH the
-- numerator and denominator and distort the readiness ratio. This function's
-- denominator is therefore intentionally wider than any single night's
-- candidate set, while still excluding drafts/retired/never-served rows via
-- the two base filters it does share.
--
-- Read-only: no writes, no schema change to question_bank/quiz_responses.
-- SECURITY DEFINER + service_role-only execution, mirroring every other
-- IRT RPC in this file family (recalibrate_question_irt_2pl,
-- select_questions_by_irt_info) — this route reads is_active/subject/grade/
-- irt_calibration_n only, no PII, and is never reachable by anon/authenticated.
--
-- Idempotent: CREATE OR REPLACE + re-asserted grants. Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_irt_calibration_readiness()
RETURNS TABLE (
  subject text,
  grade text,
  total_active_served integer,
  calibrated_n_ge_30 integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT
    q.subject,
    q.grade,
    COUNT(*)::integer AS total_active_served,
    COUNT(*) FILTER (WHERE q.irt_calibration_n >= 30)::integer AS calibrated_n_ge_30
  FROM question_bank q
  WHERE q.is_active = true
    AND EXISTS (
      SELECT 1 FROM quiz_responses r WHERE r.question_id = q.id
    )
  GROUP BY q.subject, q.grade
  ORDER BY q.subject, q.grade;
$func$;

COMMENT ON FUNCTION public.get_irt_calibration_readiness() IS
  'Master Action Plan Phase 4 Item 4.3 — per (subject, grade) breakdown of '
  'how many actively-served question_bank rows (is_active=true AND at least '
  'one quiz_responses row — the two BASE filters recalibrate_question_irt_2pl '
  'also applies, but deliberately WITHOUT its additional 7-day '
  'irt_calibrated_at staleness gate, which shrinks a single nightly run''s '
  'candidate set and would otherwise distort this readiness denominator) '
  'have crossed irt_calibration_n >= 30, the activation floor gated behind '
  'ff_irt_question_selection. Diagnostics-only; never changes serving '
  'behavior. Consumed by /api/super-admin/ai/irt-readiness.';

REVOKE ALL ON FUNCTION public.get_irt_calibration_readiness() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_irt_calibration_readiness() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_irt_calibration_readiness() TO service_role;
