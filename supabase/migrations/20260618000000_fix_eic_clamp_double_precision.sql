-- Migration: 20260618000000_fix_eic_clamp_double_precision.sql
-- Purpose: Forward-fix for the already-deployed Education Intelligence Cloud v1
--          aggregation functions (20260616000100_eic_aggregation_functions.sql).
--          Makes public.compute_education_intelligence_rollup() executable.
--
-- ─── BUG ─────────────────────────────────────────────────────────────────────
--   Running SELECT public.compute_education_intelligence_rollup(); on prod
--   aborts with:
--     ERROR 42883: function public.eic_clamp_0_100(double precision) does not exist
--     CONTEXT: compute_school_health_daily(date) line 16 ...
--   The original migration defined ONLY public.eic_clamp_0_100(p_val numeric).
--   In compute_school_health_daily the outcomes_score call is
--     public.eic_clamp_0_100(b.avg_quiz_score)
--   where b.avg_quiz_score = avg(quiz_sessions.score_percent). The base column
--   public.quiz_sessions.score_percent is `double precision` (verified in the
--   prod baseline, 00000000000000_baseline_from_prod.sql), so avg() returns
--   `double precision`. Postgres does NOT implicitly cast double precision →
--   numeric during FUNCTION-OVERLOAD resolution, so the call is unresolvable and
--   the whole rollup aborts at the first step (a).
--
-- ─── FIX ─────────────────────────────────────────────────────────────────────
--   Add a `double precision` overload of eic_clamp_0_100 that performs an
--   explicit ::numeric cast and delegates to the existing numeric clamp. This is
--   purely additive: the numeric overload is untouched. Once both overloads
--   exist, overload resolution finds an exact-type match for the double
--   precision call site and the rollup runs clean. No data change, no DROP.
--
--   Semantics parity: the existing numeric overload is
--     SELECT CASE WHEN p_val IS NULL THEN NULL
--                 WHEN p_val < 0     THEN 0
--                 WHEN p_val > 100   THEN 100
--                 ELSE p_val END;
--   The double precision wrapper casts to numeric FIRST, then delegates, so:
--     - NULL double precision → NULL::numeric → numeric clamp returns NULL  (NULL in → NULL out preserved)
--     - clamp window [0,100] and pass-through identical to the numeric path.
--   Both overloads RETURN numeric, so all call sites (which feed numeric upsert
--   columns) keep the same result type. Behaviour is identical.
--
-- ─── AUDIT OF THE OTHER FIVE FUNCTIONS (does any other 42883 lurk?) ───────────
--   Reviewed every numeric-typed function-call sink in 20260616000100 for a
--   double-precision argument that strict overload resolution would reject:
--
--   * compute_school_health_daily — eic_clamp_0_100 is called 8×. Seven of those
--     wrap an expression that is already numeric (integer/numeric arithmetic with
--     explicit ::numeric casts and numeric constants → numeric). The ONLY double
--     precision feed is eic_clamp_0_100(b.avg_quiz_score) (outcomes_score), which
--     this new overload resolves. The avg_quiz_score value is also written to the
--     numeric column school_health_daily.avg_quiz_score via INSERT — that is an
--     ASSIGNMENT cast (double precision → numeric), which Postgres performs
--     implicitly on INSERT, so it never threw and needs no change.
--   * compute_mrr_snapshot — no eic_clamp_0_100 calls. All arithmetic is on
--     numeric locals (amount_paid::numeric, price_per_seat_monthly numeric).
--     No double-precision function-call sink. Clean.
--   * compute_school_mrr_daily — no eic_clamp_0_100 calls. SUM/max over
--     numeric/integer columns with ::numeric casts. Clean.
--   * compute_school_churn_signals — eic_clamp_0_100 is called 1× on a numeric
--     expression (driver scores × numeric weights; the CASE arms and d_pay use
--     ::numeric / numeric-literal arithmetic). school_health_daily.engagement_score
--     (avg'd in eng_trend) is a numeric column, so its avg() is numeric. No
--     double-precision function-call sink. Clean.
--   * compute_geographic_metrics — eic_clamp_0_100 is called 2×. avg(composite_score)
--     feeds one: school_health_daily.composite_score is a numeric column, so its
--     avg() is numeric — resolves against the existing numeric overload. The churn_rate
--     call is integer/numeric arithmetic → numeric. No double-precision function-call
--     sink. Clean.
--
--   CONCLUSION: The single double precision overload added below fully resolves
--   the rollup. The only double-precision-typed eic_clamp_0_100 call site in the
--   entire migration is outcomes_score in compute_school_health_daily; no other
--   function-call sink receives a double precision argument. No other 42883
--   remains. After this migration,
--   SELECT public.compute_education_intelligence_rollup(); runs clean end-to-end.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- double precision overload of the [0,100] clamp. Casts to numeric and delegates
-- to the existing numeric clamp, so NULL-handling and clamp window are identical.
-- IMMUTABLE so the planner can inline it. service_role-only EXECUTE, matching the
-- security posture of the numeric overload and the compute_* writers.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eic_clamp_0_100(p_val double precision)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.eic_clamp_0_100(p_val::numeric);
$$;

REVOKE ALL    ON FUNCTION public.eic_clamp_0_100(double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eic_clamp_0_100(double precision) TO service_role;

COMMENT ON FUNCTION public.eic_clamp_0_100(double precision) IS
  'double precision overload of eic_clamp_0_100. Casts to numeric and delegates '
  'to eic_clamp_0_100(numeric) so NULL→NULL and the [0,100] clamp are identical. '
  'Added 20260618000000 to fix ERROR 42883 in compute_school_health_daily where '
  'eic_clamp_0_100(avg(quiz_sessions.score_percent)) passed a double precision '
  '(score_percent is double precision) that strict overload resolution rejected.';

COMMIT;

-- ─── Verify (manual checks AFTER applying — DO NOT RUN AS PART OF THIS TASK) ──
-- 1. Both overloads now exist:
--      SELECT proname, pg_get_function_identity_arguments(oid)
--        FROM pg_proc WHERE proname = 'eic_clamp_0_100';
--    Expected: two rows — (p_val numeric) and (p_val double precision).
-- 2. EXECUTE is service_role-only on the new overload:
--      SELECT proname, proacl FROM pg_proc
--       WHERE proname = 'eic_clamp_0_100'
--         AND pg_get_function_identity_arguments(oid) = 'p_val double precision';
-- 3. Rollup now runs clean (service_role session):
--      SELECT public.compute_education_intelligence_rollup(CURRENT_DATE);
--    Re-run → row counts stable, no 42883, no duplicate-key error (idempotent).
