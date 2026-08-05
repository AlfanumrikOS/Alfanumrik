-- Migration: 20260813000006_leaderboard_percentile_rpc.sql
-- Purpose: Foxy North-Star Phase 5 (U10 — "where do I stand?" leaderboard
--          percentile band for a single student). Adds get_leaderboard_percentile
--          which computes a student's period-scoped XP percentile against the
--          SAME population + period predicates the baseline get_leaderboard RPC
--          uses, then maps it to a coarse motivational band.
--
-- Signature:
--   get_leaderboard_percentile(p_student_id uuid, p_period text)
--     → jsonb { percentile int (0..100),
--               band text ('top_10' | 'top_25' | 'top_50' | 'keep_going') }
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (Phase 5 U10 — bandable percentile; no leaderboard rank leakage).
--
-- ─── Population + period predicate PARITY with get_leaderboard ───────────────
-- Baseline get_leaderboard(p_period, p_limit) (baseline file
-- 00000000000000_baseline_from_prod.sql line 4639) applies exactly this shape:
--   * Population: students.is_active = true, joined LEFT to daily_activity by
--     student_id + activity_date >= v_since, grouped and HAVING xp_sum > 0.
--   * Period predicate: v_since is a DATE:
--       'daily'   → CURRENT_DATE
--       'weekly'  → CURRENT_DATE - 7
--       'monthly' → CURRENT_DATE - 30
--       else      → '2020-01-01' (all-time floor)
--
-- We mirror the period CTE INLINE (v_from_ts / v_until_ts) so the percentile
-- rank is computed against the identical scope. If get_leaderboard's predicate
-- ever changes, this RPC must be re-touched in the SAME PR — assessment +
-- backend review chain (parity is the whole point of this function).
--
-- ─── Percentile formula ──────────────────────────────────────────────────────
-- Standard "percent below me" rank across the qualifying population:
--   percentile = round( (count(students with xp_period < my xp_period)
--                        / total_qualifying_students) * 100 )
--
-- Band mapping (coarse, motivational, does NOT leak absolute rank):
--   percentile >= 90 → 'top_10'
--   percentile >= 75 → 'top_25'
--   percentile >= 50 → 'top_50'
--   else            → 'keep_going'
--
-- Edge cases:
--   * Student outside the qualifying population (xp_period = 0, or is_active
--     = false) → percentile = 0, band = 'keep_going'.
--   * Only one qualifying student → percentile = 100, band = 'top_10'.
--
-- ─── SECURITY posture (INVOKER — self-only lives at the API layer) ───────────
-- SECURITY INVOKER intentionally: the canonical caller is the API route
-- /api/leaderboard/percentile (backend Phase 5 follow-up) which uses the
-- service-role Supabase client to invoke the RPC and enforces "the caller
-- may only ask about their OWN student_id" BEFORE the RPC call. Keeping the
-- RPC INVOKER means ops queries (service_role) can call it for any student
-- without a definer-side scope guard, and there is no cross-RLS surface to
-- audit here. Any student-context (anon) caller who did somehow reach it
-- would be blocked from reading peer daily_activity rows by RLS — the
-- function returns a null-safe zero band in that case.
--
-- ─── Idempotency ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE + explicit REVOKE/GRANT. No new tables, no RLS changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_leaderboard_percentile(
  p_student_id uuid,
  p_period     text DEFAULT 'weekly'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Mirror baseline get_leaderboard's date-typed window. v_until_ts is
  -- unbounded-future ('infinity') so an "all-time" query works with the same
  -- BETWEEN shape. Named `_ts` to match the spec's requested naming even though
  -- daily_activity.activity_date is a DATE column (implicit coerce is safe).
  v_from_ts  date;
  v_until_ts date := 'infinity'::date;
  v_my_xp    int;
  v_total    bigint;
  v_below    bigint;
  v_percentile int;
  v_band     text;
BEGIN
  -- Period CTE anchor — identical to baseline get_leaderboard.
  v_from_ts := CASE p_period
    WHEN 'daily'   THEN CURRENT_DATE
    WHEN 'weekly'  THEN CURRENT_DATE - 7
    WHEN 'monthly' THEN CURRENT_DATE - 30
    ELSE '2020-01-01'::date
  END;

  -- Compute the caller student's period XP. NULL when the student has no
  -- daily_activity rows in the window OR is not is_active. Coalesce to 0 so
  -- the "below" comparison is well-defined.
  SELECT COALESCE(SUM(da.xp_earned), 0)::int
    INTO v_my_xp
    FROM public.students s
    LEFT JOIN public.daily_activity da
      ON da.student_id = s.id
     AND da.activity_date >= v_from_ts
     AND da.activity_date <= v_until_ts
   WHERE s.id = p_student_id
     AND s.is_active = TRUE
   GROUP BY s.id;

  IF v_my_xp IS NULL THEN
    v_my_xp := 0;
  END IF;

  -- Qualifying population + count-below-me, mirroring get_leaderboard's
  -- "HAVING xp_period > 0 AND is_active" cohort. A student with xp_period = 0
  -- is NOT in the cohort — matching the leaderboard's own omission — so their
  -- percentile is 0 by construction.
  WITH cohort AS (
    SELECT s.id AS student_id,
           COALESCE(SUM(da.xp_earned), 0)::int AS xp_period
      FROM public.students s
      LEFT JOIN public.daily_activity da
        ON da.student_id = s.id
       AND da.activity_date >= v_from_ts
       AND da.activity_date <= v_until_ts
     WHERE s.is_active = TRUE
     GROUP BY s.id
    HAVING COALESCE(SUM(da.xp_earned), 0) > 0
  )
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE xp_period < v_my_xp)::bigint
    INTO v_total, v_below
    FROM cohort;

  -- Non-qualifying (xp = 0 or student inactive / not in cohort) → keep_going.
  IF v_total = 0 OR v_my_xp = 0 THEN
    v_percentile := 0;
  ELSE
    v_percentile := round((v_below::numeric / v_total::numeric) * 100)::int;
  END IF;

  v_band := CASE
    WHEN v_percentile >= 90 THEN 'top_10'
    WHEN v_percentile >= 75 THEN 'top_25'
    WHEN v_percentile >= 50 THEN 'top_50'
    ELSE 'keep_going'
  END;

  RETURN jsonb_build_object(
    'percentile', v_percentile,
    'band',       v_band
  );
END;
$$;

COMMENT ON FUNCTION public.get_leaderboard_percentile(uuid, text) IS
  'Foxy Phase 5 U10: single-student period-scoped percentile band. Same population + period predicate as baseline get_leaderboard. SECURITY INVOKER — the self-only enforcement lives at the API route layer (backend adds it) so ops/service_role callers can query any student.';

-- Permission posture — mirror baseline get_leaderboard: authenticated may
-- EXECUTE (canonical caller is a service-role API route; the grant lets ops
-- queries reach it too). Anon revoked.
REVOKE ALL     ON FUNCTION public.get_leaderboard_percentile(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_percentile(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_leaderboard_percentile(uuid, text) TO authenticated;

COMMIT;
