-- Migration: 20260624110000_get_class_leaderboard_rpc.sql
-- Purpose: Add get_class_leaderboard RPC + ff_class_leaderboard_v1 feature flag.
--          Returns a class-scoped XP leaderboard for a given period (daily/weekly/
--          monthly). Called exclusively through the Next.js API route
--          /api/v1/leaderboard/class/[classId], which enforces RBAC + membership
--          before invoking the RPC. The function itself is SECURITY DEFINER so it
--          can read across students / quiz_sessions without the caller's RLS.
--
-- Permission posture:
--   REVOKE ALL FROM PUBLIC  — no implicit Postgres grant
--   REVOKE EXECUTE FROM anon, authenticated
--   GRANT EXECUTE TO authenticated  — API route calls via service_role client
--     (same posture as get_leaderboard in the baseline; the API-route layer is
--     the real authorization boundary via authorizeRequest + membership check)
--
-- Idempotent: CREATE OR REPLACE; flag seed uses ON CONFLICT DO NOTHING.
-- No DROP TABLE / DROP COLUMN. No new table (no RLS needed here).
--
-- SECURITY DEFINER justification: the RPC joins class_students, students, and
-- quiz_sessions across all students in a class. RLS on those tables restricts
-- a logged-in student to their own rows, which would prevent the leaderboard
-- from reading peer rows. SECURITY DEFINER lets the function run with the
-- definer's (service_role-equivalent) rights while keeping the EXECUTE grant
-- limited to authenticated callers only. The API route layer enforces that
-- only class members / teachers can invoke it (membership check before RPC call).
-- SET search_path = public, pg_temp further locks the execution environment.

-- ─── 1. RPC ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_class_leaderboard(
  p_class_id  UUID,
  p_period    TEXT    DEFAULT 'weekly',
  p_limit     INT     DEFAULT 20
)
RETURNS TABLE (
  rank            BIGINT,
  student_id      UUID,
  name            TEXT,
  grade           TEXT,
  avatar_url      TEXT,
  xp_total        INT,
  xp_this_period  INT,
  quizzes         BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- SECURITY DEFINER: required to read peer students' quiz_sessions across RLS
-- boundary. EXECUTE is still limited to authenticated callers only (see grants
-- below). The API route enforces class-membership / teacher-ownership before
-- invoking this function. search_path is locked to prevent search-path attacks.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from TIMESTAMPTZ;
BEGIN
  -- Compute window start from p_period
  CASE p_period
    WHEN 'daily'   THEN v_from := date_trunc('day',   now());
    WHEN 'monthly' THEN v_from := date_trunc('month', now());
    ELSE                 v_from := date_trunc('week',  now());   -- weekly (default)
  END CASE;

  RETURN QUERY
  SELECT
    RANK() OVER (ORDER BY COALESCE(SUM(qs.xp_earned), 0) DESC)::BIGINT AS rank,
    s.id                                                AS student_id,
    s.name                                              AS name,
    s.grade                                             AS grade,
    s.avatar_url                                        AS avatar_url,
    s.xp                                                AS xp_total,
    COALESCE(SUM(qs.xp_earned), 0)::INT                AS xp_this_period,
    COUNT(qs.id)                                        AS quizzes
  FROM public.class_students cs
  JOIN public.students s
    ON s.id = cs.student_id
  LEFT JOIN public.quiz_sessions qs
    ON  qs.student_id  = s.id
    AND qs.is_completed = TRUE
    AND qs.created_at  >= v_from
  WHERE cs.class_id  = p_class_id
    AND cs.is_active  = TRUE
  GROUP BY s.id, s.name, s.grade, s.avatar_url, s.xp
  ORDER BY xp_this_period DESC
  LIMIT p_limit;
END;
$$;

-- ─── 2. Permission posture ────────────────────────────────────────────────────
-- Mirror the posture of get_leaderboard (baseline) which had anon EXECUTE
-- revoked by 20260515000002_security_hardening_secdef_anon_searchpath_rls_view.
-- For a new function we set this explicitly at creation time.

REVOKE ALL     ON FUNCTION public.get_class_leaderboard(UUID, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_class_leaderboard(UUID, TEXT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_class_leaderboard(UUID, TEXT, INT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_class_leaderboard(UUID, TEXT, INT) TO authenticated;

-- ─── 3. Feature flag seed ─────────────────────────────────────────────────────
-- Wrapped in a guard so fresh DBs that haven't yet created the feature_flags
-- table (schema-reproducibility order) don't error on apply.

DO $flag_seed$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_class_leaderboard_v1',
      FALSE,
      0,
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

    RAISE NOTICE 'ff_class_leaderboard_v1: flag seed applied (default OFF)';
  ELSE
    RAISE NOTICE 'ff_class_leaderboard_v1: feature_flags table not present yet; skipping seed (safe on fresh chain replay — apply after the table-creating migration)';
  END IF;
END
$flag_seed$;
