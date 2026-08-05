-- Migration: 20260813000005_leadership_readmodels.sql
-- Purpose: Foxy North-Star Phase 5 (K9 — Leadership / school-admin read models).
--          Two SECURITY DEFINER read-only RPCs powering the leadership tiles on
--          the school-admin dashboard, following the same pattern as
--          get_school_overview / get_classes_at_risk / get_teacher_engagement in
--          20260614000000_phase3b_school_command_center_read_models.sql:
--
--             get_school_safeguarding_counts(p_school_id)
--                → { open_count, resolved_30d, by_severity: {...} }
--                COUNT(*) only — never any student_id, never any row body,
--                never any disclosure_excerpt. P13-safe by construction.
--
--             get_school_competency_summary(p_school_id)
--                → aggregate mastery + retention rollup (averages only) across
--                the school's active roster. TODO(facade): swap to the mastery
--                facade aggregate when it lands, keeping this signature.
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (Phase 5 K9 — Leadership tiles; P13 privacy — counts/averages only).
--
-- ─── SECURITY DEFINER justification (mirrors get_school_overview) ────────────
-- The RPCs aggregate over safeguarding_escalations / concept_mastery /
-- students / daily_activity across an entire school. RLS on those tables
-- restricts a logged-in student/teacher to their own rows, which would prevent
-- a school-scope aggregate from being computed. SECURITY DEFINER lets the RPC
-- run with the definer's rights (service_role-equivalent) while an INTERNAL
-- scope guard restricts CALLERS to ACTIVE admins of the requested school —
-- identical to the school-admin scope guard on get_school_overview.
-- SET search_path = public, pg_temp locks the execution environment.
--
-- Neither RPC returns identifiers or row bodies — only bounded aggregates.
-- Widening either to include IDs requires a paired spec approval + a P13
-- review chain (backend + architect + testing).
--
-- ─── Idempotency ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE + explicit REVOKE/GRANT. No new tables, no RLS changes,
-- no DROP. Safe to re-run on any environment.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_school_safeguarding_counts — counts-only rollup for the safeguarding tile
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_school_safeguarding_counts(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- School-scope guard: caller must be an ACTIVE admin of THIS school.
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  WITH
  -- Every safeguarding row scoped to this school.
  scoped AS (
    SELECT category, status, reviewed_at, created_at
    FROM public.safeguarding_escalations
    WHERE school_id = p_school_id
  )
  SELECT jsonb_build_object(
    -- Currently open (still awaiting human review).
    'open_count',    (SELECT count(*) FROM scoped WHERE status = 'pending_review'),
    -- Resolved (reviewed / actioned / dismissed) in the last rolling 30 days.
    'resolved_30d',  (SELECT count(*) FROM scoped
                       WHERE status IN ('reviewed', 'actioned', 'dismissed')
                         AND reviewed_at IS NOT NULL
                         AND reviewed_at >= (now() - interval '30 days')),
    -- Severity == safeguarding category (self_harm / abuse / violence /
    -- acute_distress) in this domain — see safeguarding_escalations CHECK.
    -- Counts only, one row per category present in scope.
    'by_severity',   COALESCE(
      (SELECT jsonb_object_agg(category, cnt)
         FROM (SELECT category, count(*) AS cnt
                 FROM scoped
                 WHERE status = 'pending_review'
                 GROUP BY category) g),
      '{}'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_school_safeguarding_counts(uuid) IS
  'Foxy Phase 5 K9 leadership tile: counts-only rollup of safeguarding_escalations for the school (open_count, resolved_30d, by_severity). NEVER returns student_id, row body, or disclosure_excerpt (P13). SECURITY DEFINER with school-admin scope guard.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_school_competency_summary — aggregate mastery + retention rollup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_school_competency_summary(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- TODO(facade): swap the raw concept_mastery / daily_activity aggregates
  -- below for the mastery-facade aggregate view when it lands (Phase 6). The
  -- SIGNATURE of this RPC is the leadership-tile contract — keep it stable
  -- across the swap so the frontend does not need to change.
  WITH
  school_classes AS (
    SELECT c.id
    FROM public.classes c
    WHERE c.school_id = p_school_id
      AND c.is_active
      AND c.deleted_at IS NULL
  ),
  active_roster AS (
    SELECT DISTINCT cs.student_id
    FROM public.class_students cs
    JOIN school_classes sc ON sc.id = cs.class_id
    JOIN public.students st ON st.id = cs.student_id
    WHERE cs.is_active
      AND st.is_active
  ),
  -- Current-mastery aggregate (average p_know across the roster's concepts).
  current_mastery AS (
    SELECT AVG(cm.p_know)::numeric AS avg_pknow_now,
           count(*)::bigint       AS mastery_rows
    FROM public.concept_mastery cm
    JOIN active_roster ar ON ar.student_id = cm.student_id
  ),
  -- Growth proxy over the last 30d: fraction of mastery rows updated in that
  -- window (higher = more active mastery movement). A true delta series
  -- requires the mastery facade timeseries (TODO(facade)) — this is a
  -- forward-compatible placeholder that reads only aggregates.
  growth_30d AS (
    SELECT AVG(CASE
                 WHEN cm.updated_at >= (now() - interval '30 days') THEN 1.0
                 ELSE 0.0
               END)::numeric AS movement_ratio
    FROM public.concept_mastery cm
    JOIN active_roster ar ON ar.student_id = cm.student_id
  ),
  -- Retention proxy: % of the active roster with ANY daily_activity row in
  -- the last 30 days (counts only — no per-student surfacing).
  retention_30d AS (
    SELECT (count(DISTINCT da.student_id)::numeric
             / NULLIF((SELECT count(*) FROM active_roster), 0)::numeric)
             AS retention_ratio
    FROM public.daily_activity da
    JOIN active_roster ar ON ar.student_id = da.student_id
    WHERE da.activity_date >= (CURRENT_DATE - 30)
  )
  SELECT jsonb_build_object(
    'roster_size',        (SELECT count(*) FROM active_roster),
    'avg_mastery_now',    (SELECT round(avg_pknow_now, 4) FROM current_mastery),
    'mastery_movement_ratio_30d',
                          (SELECT round(movement_ratio, 4) FROM growth_30d),
    'retention_pct_30d',  (SELECT
                             CASE WHEN retention_ratio IS NULL THEN NULL
                                  ELSE round(retention_ratio * 100, 2)
                             END
                           FROM retention_30d),
    'data_state',         CASE
      WHEN (SELECT count(*) FROM active_roster) = 0
       AND (SELECT mastery_rows FROM current_mastery) = 0
        THEN 'no_data'
      ELSE 'live'
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_school_competency_summary(uuid) IS
  'Foxy Phase 5 K9 leadership tile: aggregate mastery + retention rollup across the school''s active roster. Averages/counts only — never per-student rows. SECURITY DEFINER with school-admin scope guard. TODO(facade): swap the concept_mastery/daily_activity aggregates for the mastery facade aggregate when it lands, keeping this signature stable.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Grants — authenticated only; the scope guard does the rest.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL     ON FUNCTION public.get_school_safeguarding_counts(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_school_safeguarding_counts(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_school_safeguarding_counts(uuid) TO authenticated;

REVOKE ALL     ON FUNCTION public.get_school_competency_summary(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_school_competency_summary(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_school_competency_summary(uuid) TO authenticated;

COMMIT;
