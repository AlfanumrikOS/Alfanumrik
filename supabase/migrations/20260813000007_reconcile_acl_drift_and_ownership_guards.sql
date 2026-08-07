-- Migration: 20260813000007_reconcile_acl_drift_and_ownership_guards.sql
-- Purpose: One migration closing the two classes of SECURITY DEFINER RPC
--          authorization defects found by the 2026-08 data-platform audit:
--
--   CLASS 1 — FRESH-ENVIRONMENT ACL DRIFT (schema reproducibility)
--     The baseline pg_dump (00000000000000_baseline_from_prod.sql) carries no
--     per-function ACL statements and ends with
--       ALTER DEFAULT PRIVILEGES ... GRANT ALL ... (baseline ~22631-22637),
--     so every function it creates inherits the default PUBLIC EXECUTE.
--     The REVOKEs that lock the four service-side RPCs below to
--     service_role-only live ONLY in the pre-baseline legacy chain
--     (_legacy/timestamped/20260408000017, 20260414120000, 20260427000002,
--     20260408000019). `supabase db push` applies only the migrations/ ROOT, so
--     the CLI skips _legacy/ entirely — fresh environments (CI live-DB tests,
--     new staging, DR restores) therefore restore these definer-rights functions
--     as PUBLIC-executable. This block replays the legacy REVOKEs idempotently
--     on every environment, prod and fresh alike.
--
--   CLASS 2 — MISSING OWNERSHIP GUARDS ON PROD-REACHABLE RPCs
--     Eight client- or admin-callable SECURITY DEFINER RPCs take a caller-
--     supplied student / auth-user id with NO internal ownership check. Their
--     anon EXECUTE was revoked (20260515000002, 20260623000700/00800,
--     20260715170000), but `authenticated` retains EXECUTE, so ANY signed-in
--     JWT holder can call them via PostgREST with an ARBITRARY victim id and
--     read or write another student's data. This applies the house ownership
--     guard — the IDENTICAL pattern already used by submit_quiz_results_v2
--     (baseline ~7629-7634) and applied to the quiz RPC family in
--     20260702150000_p3w1_5_quiz_rpc_ownership_check.sql:
--       IF auth.uid() IS NOT NULL AND NOT EXISTS (
--         SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
--       ) THEN RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
--       END IF;
--     The `auth.uid() IS NOT NULL AND` prefix is the deliberate service-role
--     escape hatch: a service-role caller carries no JWT so auth.uid() IS NULL
--     and the guard short-circuits. Every verified production caller either
--     passes the owner's own id (browser client) or uses a service-role client
--     (routes, cron, edge functions, integration tests) — so this is purely
--     ADDITIVE for legitimate traffic.
--
-- SCOPE (audit-verified callers — guard is provably safe for all of them):
--   * get_dashboard_data          — browser dashboard (own id); super-admin
--       students/[id]/dashboard route + e2e tests (service role).
--   * get_bloom_progression       — /progress MasteryBloomPanel (own id).
--   * get_knowledge_gaps          — /progress + KnowledgeGapActions (own id);
--       /api/v2/student/progress route.ts:65 (service role).
--   * get_study_plan              — /study-plan page (own id).
--   * mark_all_notifications_read — notifications UI (own id).
--   * submit_challenge_attempt    — /challenge page.tsx (own id); write path
--       into challenge_attempts / challenge_streaks / coins.
--   * get_user_permissions(uuid)            — rbac.ts:182 (service role);
--       usePermissions.ts:64 (own uid).
--   * get_user_permissions(uuid,uuid)       — rbac.ts (service role);
--       school_admin_has_selected_permission (passes auth.uid()).
--   * atomic_school_plan_change   — /api/school-admin/subscription route.ts:671
--       (service role); direct client callers must be active school_admins.
--
-- IDEMPOTENT: REVOKE/GRANT are replay-safe; every REPLACE uses
-- DROP FUNCTION IF EXISTS + CREATE OR REPLACE (matching the defining
-- migrations 20260623000700/00800) or plain CREATE OR REPLACE, so the file can
-- be replayed without error. No schema/RLS change, no DROP of tables, no
-- behavior change for any legitimate caller (guards are ownership assertions,
-- not privilege boundaries — service_role already bypasses RLS).

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART A — FRESH-ENVIRONMENT ACL RECONCILIATION (service-side RPCs)
-- Replays the _legacy chain's REVOKEs that are silently skipped on fresh
-- environments. All four functions have NO legitimate client-side caller.
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. get_cron_secret() — holds the pg_cron / internal-auth shared secret.
--     Callers: service-role edge functions (alert-deliverer/index.ts:28-30,
--     _shared/security/internal-cron-auth.ts) and pg_cron only.
--     Mirrors _legacy 20260408000017 lines 7-8.
REVOKE ALL   ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;

-- A2. atomic_plan_change(uuid, text, text) — student subscription plan change.
--     Callers: service-role API routes only (/api/internal/admin/users/[id],
--     /api/internal/admin/bulk-action, /api/super-admin/bulk-actions/plan-change).
--     Mirrors _legacy 20260427000002 lines 177-180.
REVOKE ALL   ON FUNCTION public.atomic_plan_change(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_plan_change(uuid, text, text) TO service_role;

-- A3. create_pending_subscription(uuid, text, text, text, text, text, integer)
--     — atomic pending-subscription write from the Razorpay subscribe flow.
--     Caller: /api/payments/subscribe route.ts:288 (service role).
--     Mirrors _legacy 20260414120000 lines 170-173.
REVOKE ALL   ON FUNCTION public.create_pending_subscription(uuid, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_pending_subscription(uuid, text, text, text, text, text, integer) TO service_role;

-- A4. record_platform_health_snapshot() — writes platform_health_snapshots.
--     Caller: governance-health cron (service role). Created by legacy
--     20260408000019 which never tightened its ACL.
REVOKE ALL   ON FUNCTION public.record_platform_health_snapshot() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_platform_health_snapshot() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART B — atomic_school_plan_change: revoke the authenticated re-grant + add
--          the school-admin membership guard
--  20260507000003 created this SECURITY DEFINER RPC with service_role-only
--  grants, but 20260510033000 re-granted EXECUTE to `authenticated` (an
--  over-revocation correction) AND the body has no ownership check — so an
--  authenticated student can call it with an ARBITRARY school_id and change
--  another school's subscription (P11 school-billing integrity).
--  Fix: (1) guard below (membership-check pattern from 20260711230713), and
--  (2) re-assert service_role-only EXECUTE. The sole production caller
--  (school-admin/subscription route.ts:671) uses a service-role client, so
--  auth.uid() IS NULL and the guard is skipped. Direct client callers must be
--  an ACTIVE school_admins member of p_school_id.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.atomic_school_plan_change(
  p_school_id   uuid,
  p_new_plan    text DEFAULT NULL,
  p_new_seats   integer DEFAULT NULL,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_canonical_plan   text;
  v_plan_id          uuid;
  v_old_plan         text;
  v_old_seats        integer;
  v_old_billing      text;
  v_seats_active     integer;
  v_now              timestamptz := now();
BEGIN
  -- ── 0. Authorization ───────────────────────────────────────────────
  -- SECURITY FIX (2026-08-13): a client-session caller must be an ACTIVE
  -- administrator of p_school_id. Service-role callers (the school-admin
  -- subscription route) have auth.uid() = NULL and skip this check entirely.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.school_admins sa
    JOIN public.schools sc ON sc.id = sa.school_id AND sc.is_active = true
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active = true
  ) THEN
    RAISE EXCEPTION 'Access denied: caller is not an active administrator of school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- ── 1. Argument validation ─────────────────────────────────────────
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'p_school_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_new_plan IS NULL AND p_new_seats IS NULL THEN
    RAISE EXCEPTION 'must provide p_new_plan or p_new_seats' USING ERRCODE = '22023';
  END IF;
  IF p_new_seats IS NOT NULL AND (p_new_seats < 1 OR p_new_seats > 5000) THEN
    RAISE EXCEPTION 'p_new_seats must be 1..5000 (got %)', p_new_seats USING ERRCODE = '22023';
  END IF;

  -- ── 2. Canonicalize plan_code (mirrors the student-side RPC) ───────
  IF p_new_plan IS NOT NULL THEN
    v_canonical_plan := p_new_plan;
    v_canonical_plan := regexp_replace(v_canonical_plan, '_(monthly|yearly)$', '');
    IF v_canonical_plan = 'ultimate' THEN v_canonical_plan := 'unlimited'; END IF;
    IF v_canonical_plan = 'basic'    THEN v_canonical_plan := 'starter';   END IF;
    IF v_canonical_plan = 'premium'  THEN v_canonical_plan := 'pro';       END IF;

    -- 'free' is rejected for schools (B2C-only plan).
    IF v_canonical_plan = 'free' THEN
      RAISE EXCEPTION 'free plan is not valid for schools' USING ERRCODE = '22023';
    END IF;

    -- Validate against subscription_plans
    SELECT id INTO v_plan_id
      FROM subscription_plans
     WHERE plan_code = v_canonical_plan
       AND is_active = true
     LIMIT 1;
    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plan not found or inactive in subscription_plans: % (input %)',
        v_canonical_plan, p_new_plan USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── 3. Per-school advisory lock ────────────────────────────────────
  -- Different namespace from the student lock so a school PATCH does
  -- NOT block a concurrent student plan-change (different rows entirely).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_subscription:' || p_school_id::text, 0)
  );

  -- ── 4. Capture prior state under FOR UPDATE ────────────────────────
  SELECT plan, seats_purchased, billing_cycle
    INTO v_old_plan, v_old_seats, v_old_billing
    FROM school_subscriptions
   WHERE school_id = p_school_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No subscription for school_id %', p_school_id USING ERRCODE = 'P0002';
  END IF;

  -- ── 5. Seat-cap server-side guard ──────────────────────────────────
  -- The route already checks this, but a service-role caller (cron, ops
  -- script) could reach the RPC directly. Match the canonical definition
  -- used everywhere else: COUNT(students WHERE school_id = X AND is_active = true).
  IF p_new_seats IS NOT NULL THEN
    SELECT COUNT(*) INTO v_seats_active
      FROM students
     WHERE school_id = p_school_id
       AND is_active = true;

    IF p_new_seats < v_seats_active THEN
      RAISE EXCEPTION 'Cannot reduce seats to % below active student count %',
        p_new_seats, v_seats_active USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── 6. Single-transaction update ───────────────────────────────────
  UPDATE school_subscriptions
     SET plan            = COALESCE(v_canonical_plan, plan),
         seats_purchased = COALESCE(p_new_seats, seats_purchased),
         updated_at      = v_now
   WHERE school_id = p_school_id;

  -- ── 7. Audit trail via domain_events outbox (best-effort) ──────────
  BEGIN
    PERFORM public.enqueue_event(
      'school_subscription.plan_changed',
      'school',
      p_school_id,
      jsonb_build_object(
        'school_id',     p_school_id,
        'old_plan',      v_old_plan,
        'new_plan',      v_canonical_plan,
        'old_seats',     v_old_seats,
        'new_seats',     p_new_seats,
        'billing_cycle', v_old_billing,
        'reason',        p_reason,
        'changed_at',    v_now,
        'source',        'atomic_school_plan_change_rpc'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'atomic_school_plan_change: enqueue_event failed (% / %), continuing',
      SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'success',       true,
    'school_id',     p_school_id,
    'old_plan',      v_old_plan,
    'new_plan',      v_canonical_plan,
    'old_seats',     v_old_seats,
    'new_seats',     p_new_seats,
    'billing_cycle', v_old_billing,
    'reason',        p_reason,
    'changed_at',    v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) TO service_role;

COMMENT ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) IS
  'Atomic school subscription plan/seat change. Updates school_subscriptions in a single transaction guarded by pg_advisory_xact_lock(''school_subscription:''||school_id). Mirrors student-side atomic_plan_change for the school billing path (PR #549/#555). service_role-only EXECUTE; client-session callers must be active school_admins of p_school_id. Route layer handles Razorpay coordination separately.';

-- ═════════════════════════════════════════════════════════════════════════════
-- PART C — OWNERSHIP GUARDS on client-reachable SECURITY DEFINER RPCs
--  House pattern from 20260702150000 (and submit_quiz_results_v2): the guard
--  is ADDITIVE for every legitimate caller and raises for cross-user abuse.
--  Every REPLACE re-asserts the full ACL explicitly: anon AND PUBLIC revoked,
--  authenticated + service_role granted — so fresh envs are left in the exact
--  same hardened posture (no reliance on the default PUBLIC EXECUTE).
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── C1. get_dashboard_data(p_student_id uuid) ──────────────────────────────
DROP FUNCTION IF EXISTS public.get_dashboard_data(p_student_id uuid);

CREATE OR REPLACE FUNCTION public.get_dashboard_data(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  result jsonb;
  v_student record;
  v_profiles jsonb;
  v_due_count int;
  v_unread_count int;
  v_gaps jsonb;
  v_velocity numeric;
  v_bloom jsonb;
  v_cbse_readiness numeric;
  v_exams jsonb;
  v_nudges jsonb;
  v_retention_score numeric;
  v_error_breakdown jsonb;
BEGIN
  -- SECURITY FIX (2026-08-13): ownership guard (20260702150000 pattern).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  SELECT * INTO v_student FROM students WHERE id = p_student_id;
  IF v_student IS NULL THEN
    RETURN jsonb_build_object('error', 'Student not found');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(slp)), '[]'::jsonb)
  INTO v_profiles
  FROM student_learning_profiles slp
  WHERE slp.student_id = p_student_id;

  SELECT count(*) INTO v_due_count
  FROM concept_mastery
  WHERE student_id = p_student_id AND next_review_at <= now();

  SELECT count(*) INTO v_unread_count
  FROM notifications
  WHERE recipient_id = p_student_id AND is_read = false;

  SELECT COALESCE(jsonb_agg(row_to_json(g) ORDER BY g.confidence_score DESC), '[]'::jsonb)
  INTO v_gaps
  FROM (
    SELECT
      cm.topic_id                                        AS id,
      ct.title                                           AS target_concept_name,
      ct.title                                           AS missing_prerequisite_name,
      'open'::text                                       AS status,
      ROUND((1 - COALESCE(cm.mastery_probability, 0))::numeric, 4) AS confidence_score
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s ON s.id = ct.subject_id
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
      AND (
        COALESCE(cm.mastery_probability, 0) < 0.5
        OR COALESCE(cm.error_count_conceptual, 0) >= 2
      )
    ORDER BY COALESCE(cm.mastery_probability, 0) ASC
    LIMIT 3
  ) g;

  SELECT weekly_mastery_rate INTO v_velocity
  FROM learning_velocity
  WHERE student_id = p_student_id
  ORDER BY last_calculated_at DESC LIMIT 1;

  WITH bloom_avg AS (
    SELECT
      AVG(COALESCE((cm.bloom_mastery->>'remember')::float,   0)) AS remember_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'understand')::float,  0)) AS understand_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'apply')::float,       0)) AS apply_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'analyze')::float,     0)) AS analyze_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'evaluate')::float,    0)) AS evaluate_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'create')::float,      0)) AS create_mastery,
      COUNT(*) AS n
    FROM concept_mastery cm
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
  )
  SELECT CASE WHEN ba.n > 0 THEN jsonb_build_object(
    'current_bloom_level', CASE
      WHEN ba.create_mastery   >= 0.6 THEN 'create'
      WHEN ba.evaluate_mastery >= 0.6 THEN 'evaluate'
      WHEN ba.analyze_mastery  >= 0.6 THEN 'analyze'
      WHEN ba.apply_mastery    >= 0.6 THEN 'apply'
      WHEN ba.understand_mastery >= 0.6 THEN 'understand'
      ELSE 'remember'
    END,
    'remember_mastery',   ROUND(ba.remember_mastery::numeric,   4),
    'understand_mastery', ROUND(ba.understand_mastery::numeric, 4),
    'apply_mastery',      ROUND(ba.apply_mastery::numeric,      4),
    'analyze_mastery',    ROUND(ba.analyze_mastery::numeric,    4),
    'evaluate_mastery',   ROUND(ba.evaluate_mastery::numeric,   4),
    'create_mastery',     ROUND(ba.create_mastery::numeric,     4)
  ) ELSE NULL END
  INTO v_bloom
  FROM bloom_avg ba;

  SELECT cbse_readiness_pct INTO v_cbse_readiness
  FROM adaptive_profile WHERE student_id = p_student_id LIMIT 1;

  SELECT COALESCE(jsonb_agg(row_to_json(e)), '[]'::jsonb) INTO v_exams
  FROM (
    SELECT id, exam_name, exam_type, subject, exam_date
    FROM exam_configs
    WHERE student_id = p_student_id AND is_active = true AND exam_date >= CURRENT_DATE
    ORDER BY exam_date LIMIT 3
  ) e;

  SELECT COALESCE(jsonb_agg(row_to_json(n)), '[]'::jsonb) INTO v_nudges
  FROM (
    SELECT id, nudge_type, message, message_hi, priority
    FROM smart_nudges
    WHERE student_id = p_student_id AND is_read = false AND is_dismissed = false
    ORDER BY priority DESC LIMIT 3
  ) n;

  SELECT ROUND(AVG(retention_score_percent)) INTO v_retention_score
  FROM (
    SELECT retention_score_percent FROM retention_tests
    WHERE student_id = p_student_id AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 10
  ) r;

  WITH recent_errors AS (
    SELECT response_time_seconds
    FROM question_responses
    WHERE student_id = p_student_id AND is_correct = false
    ORDER BY created_at DESC LIMIT 50
  ), stats AS (
    SELECT
      count(*) as total,
      AVG(COALESCE(response_time_seconds, 10)) as avg_time
    FROM recent_errors
  )
  SELECT CASE WHEN s.total > 0 THEN jsonb_build_object(
    'careless', ROUND(100.0 * count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) < GREATEST(s.avg_time * 0.3, 3)) / s.total),
    'conceptual', ROUND(100.0 * count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) > s.avg_time * 2.5) / s.total),
    'misinterpretation', ROUND(100.0 * (s.total
      - count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) < GREATEST(s.avg_time * 0.3, 3))
      - count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) > s.avg_time * 2.5)
    ) / s.total)
  ) ELSE NULL END
  INTO v_error_breakdown
  FROM recent_errors re, stats s
  GROUP BY s.total, s.avg_time;

  result := jsonb_build_object(
    'profiles', v_profiles,
    'due_count', COALESCE(v_due_count, 0),
    'unread_count', COALESCE(v_unread_count, 0),
    'knowledge_gaps', v_gaps,
    'velocity', v_velocity,
    'bloom', v_bloom,
    'cbse_readiness', v_cbse_readiness,
    'exams', v_exams,
    'nudges', v_nudges,
    'retention_score', v_retention_score,
    'error_breakdown', v_error_breakdown
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_data(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dashboard_data(uuid) TO authenticated, service_role;

-- ─── C2. get_bloom_progression(uuid, text) ─────────────────────────────────
DROP FUNCTION IF EXISTS public.get_bloom_progression(p_student_id uuid, p_subject text);

CREATE OR REPLACE FUNCTION public.get_bloom_progression(
  p_student_id uuid,
  p_subject text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- SECURITY FIX (2026-08-13): ownership guard (20260702150000 pattern).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  WITH per_subject AS (
    SELECT
      s.code AS subject,
      AVG(COALESCE((cm.bloom_mastery->>'remember')::float,   0)) AS remember_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'understand')::float,  0)) AS understand_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'apply')::float,       0)) AS apply_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'analyze')::float,     0)) AS analyze_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'evaluate')::float,    0)) AS evaluate_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'create')::float,      0)) AS create_mastery,
      MAX(cm.updated_at) AS updated_at
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s ON s.id = ct.subject_id
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
      AND (p_subject IS NULL OR s.code = p_subject)
    GROUP BY s.code
  ),
  with_levels AS (
    SELECT
      ps.*,
      CASE
        WHEN ps.create_mastery   >= 0.6 THEN 'create'
        WHEN ps.evaluate_mastery >= 0.6 THEN 'evaluate'
        WHEN ps.analyze_mastery  >= 0.6 THEN 'analyze'
        WHEN ps.apply_mastery    >= 0.6 THEN 'apply'
        WHEN ps.understand_mastery >= 0.6 THEN 'understand'
        ELSE 'remember'
      END AS current_bloom_level
    FROM per_subject ps
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'concept_id', NULL,
      'subject', wl.subject,
      'current_bloom_level', wl.current_bloom_level,
      'zpd_bloom_level', CASE wl.current_bloom_level
        WHEN 'remember'   THEN 'understand'
        WHEN 'understand' THEN 'apply'
        WHEN 'apply'      THEN 'analyze'
        WHEN 'analyze'    THEN 'evaluate'
        WHEN 'evaluate'   THEN 'create'
        WHEN 'create'     THEN 'create'
        ELSE 'understand'
      END,
      'remember_mastery',   ROUND(wl.remember_mastery::numeric,   4),
      'understand_mastery', ROUND(wl.understand_mastery::numeric, 4),
      'apply_mastery',      ROUND(wl.apply_mastery::numeric,      4),
      'analyze_mastery',    ROUND(wl.analyze_mastery::numeric,    4),
      'evaluate_mastery',   ROUND(wl.evaluate_mastery::numeric,   4),
      'create_mastery',     ROUND(wl.create_mastery::numeric,     4),
      'updated_at', wl.updated_at
    )
    ORDER BY wl.updated_at DESC NULLS LAST
  ), '[]'::jsonb)
  INTO v_result
  FROM with_levels wl;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bloom_progression(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bloom_progression(uuid, text) TO authenticated, service_role;

-- ─── C3. get_knowledge_gaps(uuid, text, integer) ───────────────────────────
DROP FUNCTION IF EXISTS public.get_knowledge_gaps(p_student_id uuid, p_subject text, p_limit integer);

CREATE OR REPLACE FUNCTION public.get_knowledge_gaps(
  p_student_id uuid,
  p_subject text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- SECURITY FIX (2026-08-13): ownership guard (20260702150000 pattern).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  WITH weak AS (
    SELECT
      cm.topic_id,
      cm.student_id,
      s.code AS subject,
      ct.title AS topic,
      COALESCE(cm.mastery_probability, 0) AS mastery_probability,
      cm.updated_at,
      (1 - COALESCE(cm.mastery_probability, 0)) AS confidence_score
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s ON s.id = ct.subject_id
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
      AND (
        COALESCE(cm.mastery_probability, 0) < 0.5
        OR COALESCE(cm.error_count_conceptual, 0) >= 2
      )
      AND (p_subject IS NULL OR s.code = p_subject)
    ORDER BY COALESCE(cm.mastery_probability, 0) ASC
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', w.topic_id,
      'student_id', w.student_id,
      'concept_id', w.topic_id,
      'subject', w.subject,
      'topic', w.topic,
      'target_concept_name', w.topic,
      'missing_prerequisite_name', w.topic,
      'detection_method', CASE
        WHEN w.mastery_probability < 0.5 THEN 'low_mastery'
        ELSE 'conceptual_errors'
      END,
      'confidence_score', ROUND(w.confidence_score::numeric, 4),
      'mastery_probability', ROUND(w.mastery_probability::numeric, 4),
      'severity', CASE
        WHEN w.confidence_score > 0.7 THEN 'critical'
        WHEN w.confidence_score > 0.4 THEN 'high'
        ELSE 'medium'
      END,
      'status', 'open',
      'detected_at', w.updated_at
    )
    ORDER BY w.mastery_probability ASC
  ), '[]'::jsonb)
  INTO v_result
  FROM weak w;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_knowledge_gaps(uuid, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_knowledge_gaps(uuid, text, integer) TO authenticated, service_role;

-- ─── C4. get_study_plan(uuid) ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_study_plan(p_student_id uuid);

CREATE OR REPLACE FUNCTION public.get_study_plan(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_plan RECORD;
  v_tasks jsonb;
BEGIN
  -- SECURITY FIX (2026-08-13): ownership guard (20260702150000 pattern).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  SELECT * INTO v_plan
  FROM study_plans
  WHERE student_id = p_student_id AND is_active = true
  ORDER BY created_at DESC LIMIT 1;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('has_plan', false);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', t.id, 'day_number', t.day_number, 'scheduled_date', t.scheduled_date,
    'task_order', t.task_order, 'task_type', t.task_type, 'title', t.title,
    'description', t.description, 'subject', t.subject, 'chapter_number', t.chapter_number,
    'chapter_title', t.chapter_title, 'topic', t.topic, 'duration_minutes', t.duration_minutes,
    'question_count', t.question_count, 'difficulty', t.difficulty, 'status', t.status,
    'xp_reward', t.xp_reward, 'xp_earned', t.xp_earned, 'score_percent', t.score_percent
  ) ORDER BY t.day_number, t.task_order)
  INTO v_tasks
  FROM study_plan_tasks t
  WHERE t.plan_id = (
    SELECT id
    FROM study_plans
    WHERE student_id = p_student_id AND is_active = true
    ORDER BY created_at DESC LIMIT 1
  );

  RETURN (
    SELECT jsonb_build_object(
      'has_plan', true,
      'plan', jsonb_build_object(
        'id', sp.id,
        'subject', sp.subject,
        'title', sp.title,
        'description', sp.description,
        'plan_type', sp.plan_type,
        'start_date', sp.start_date,
        'end_date', sp.end_date,
        'total_tasks', sp.total_tasks,
        'completed_tasks', (SELECT count(*) FROM study_plan_tasks WHERE plan_id = sp.id AND status = 'completed'),
        'progress_percent', CASE
          WHEN sp.total_tasks > 0 THEN round(
            (SELECT count(*)::numeric FROM study_plan_tasks WHERE plan_id = sp.id AND status = 'completed')
            / sp.total_tasks * 100
          )
          ELSE 0
        END,
        'ai_reasoning', sp.ai_reasoning
      ),
      'tasks', COALESCE(v_tasks, '[]'::jsonb)
    )
    FROM study_plans sp
    WHERE sp.student_id = p_student_id AND sp.is_active = true
    ORDER BY sp.created_at DESC LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_plan(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_study_plan(uuid) TO authenticated, service_role;

-- ─── C5. mark_all_notifications_read(uuid) ────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_all_notifications_read(p_student_id uuid);

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- SECURITY FIX (2026-08-13): ownership guard (20260702150000 pattern).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  UPDATE notifications SET is_read = true, read_at = now()
  WHERE recipient_id = p_student_id AND NOT is_read;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated, service_role;

-- ─── C6. submit_challenge_attempt(...) — write path (challenge_attempts /
--         challenge_streaks / coins). Same defect class as the quiz RPCs
--         fixed in 20260702150000; included under the same carve-out.
DROP FUNCTION IF EXISTS public.submit_challenge_attempt(p_student_id uuid, p_challenge_id uuid, p_solved boolean, p_moves integer, p_hints_used integer, p_distractors_excluded integer, p_time_spent integer, p_coins_earned integer);

CREATE OR REPLACE FUNCTION public.submit_challenge_attempt(
  p_student_id uuid,
  p_challenge_id uuid,
  p_solved boolean,
  p_moves integer,
  p_hints_used integer,
  p_distractors_excluded integer,
  p_time_spent integer,
  p_coins_earned integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_attempt_id UUID; v_new_streak INTEGER; v_new_balance INTEGER;
BEGIN
  -- SECURITY FIX (2026-08-13): ownership guard (20260702150000 pattern).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  INSERT INTO challenge_attempts (student_id, challenge_id, solved, moves, hints_used, distractors_excluded, time_spent_seconds, coins_earned)
  VALUES (p_student_id, p_challenge_id, p_solved, p_moves, p_hints_used, p_distractors_excluded, p_time_spent, p_coins_earned)
  ON CONFLICT (student_id, challenge_id) DO UPDATE SET solved=EXCLUDED.solved, moves=EXCLUDED.moves, hints_used=EXCLUDED.hints_used, distractors_excluded=EXCLUDED.distractors_excluded, time_spent_seconds=EXCLUDED.time_spent_seconds, coins_earned=EXCLUDED.coins_earned, attempted_at=now()
  RETURNING id INTO v_attempt_id;

  IF p_solved THEN
    INSERT INTO challenge_streaks (student_id, current_streak, best_streak, last_challenge_date)
    VALUES (p_student_id, 1, 1, CURRENT_DATE)
    ON CONFLICT (student_id) DO UPDATE SET
      current_streak = CASE
        WHEN challenge_streaks.last_challenge_date = CURRENT_DATE THEN challenge_streaks.current_streak
        WHEN challenge_streaks.last_challenge_date = CURRENT_DATE - 1 THEN challenge_streaks.current_streak + 1
        ELSE 1
      END,
      best_streak = GREATEST(challenge_streaks.best_streak, CASE
        WHEN challenge_streaks.last_challenge_date = CURRENT_DATE - 1 THEN challenge_streaks.current_streak + 1
        ELSE 1
      END),
      last_challenge_date = CURRENT_DATE;

    SELECT current_streak INTO v_new_streak FROM challenge_streaks WHERE student_id = p_student_id;

    IF p_coins_earned > 0 THEN
      SELECT award_coins(p_student_id, p_coins_earned, 'daily_challenge', jsonb_build_object('challenge_id', p_challenge_id)) INTO v_new_balance;
    END IF;
  END IF;

  RETURN jsonb_build_object('attempt_id', v_attempt_id, 'solved', p_solved, 'streak', COALESCE(v_new_streak, 0), 'coin_balance', COALESCE(v_new_balance, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.submit_challenge_attempt(uuid, uuid, boolean, integer, integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_challenge_attempt(uuid, uuid, boolean, integer, integer, integer, integer, integer) TO authenticated, service_role;

-- ─── C7. get_user_permissions(uuid) — caller must own the resolved uid ─────
DROP FUNCTION IF EXISTS public.get_user_permissions(p_auth_user_id uuid);

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE v_result JSONB;
BEGIN
  -- SECURITY FIX (2026-08-13): a client-session caller may only resolve their
  -- OWN permissions. Service-role callers (rbac.ts via getServiceClient) have
  -- auth.uid() = NULL and skip the check.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_auth_user_id THEN
    RAISE EXCEPTION 'Access denied: caller does not own user %', p_auth_user_id;
  END IF;

  SELECT jsonb_build_object(
    'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', r.name, 'display_name', r.display_name, 'hierarchy_level', r.hierarchy_level)) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.auth_user_id = p_auth_user_id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now()) AND r.is_active = true), '[]'::jsonb),
    'permissions', COALESCE((SELECT jsonb_agg(DISTINCT p.code) FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.auth_user_id = p_auth_user_id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now()) AND p.is_active = true), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_permissions(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO authenticated, service_role;

-- ─── C8. get_user_permissions(uuid, uuid) — same guard on the school-scoped
--         overload (20260715170000). school_admin_has_selected_permission
--         calls it with auth.uid() as p_auth_user_id, so it is unaffected.
DROP FUNCTION IF EXISTS public.get_user_permissions(p_auth_user_id uuid, p_school_id uuid);

CREATE OR REPLACE FUNCTION public.get_user_permissions(
  p_auth_user_id uuid,
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_is_school_admin BOOLEAN;
BEGIN
  -- SECURITY FIX (2026-08-13): a client-session caller may only resolve their
  -- OWN permissions for a school. Service-role callers (rbac.ts) and the
  -- SECURITY DEFINER resolver school_admin_has_selected_permission (which
  -- passes auth.uid()) have auth.uid() matching p_auth_user_id or NULL, so
  -- this is additive for every legitimate caller.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_auth_user_id THEN
    RAISE EXCEPTION 'Access denied: caller does not own user %', p_auth_user_id;
  END IF;

  v_is_school_admin := EXISTS (
    SELECT 1
    FROM school_admins sa
    WHERE sa.auth_user_id = p_auth_user_id
      AND sa.school_id = p_school_id
      AND sa.is_active = true
  );

  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', r.name,
               'display_name', r.display_name,
               'hierarchy_level', r.hierarchy_level))
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND r.is_active = true
        AND (r.name <> 'institution_admin' OR v_is_school_admin)
    ), '[]'::jsonb),
    'permissions', COALESCE((
      SELECT jsonb_agg(DISTINCT p.code)
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND p.is_active = true
        AND (r.name <> 'institution_admin' OR v_is_school_admin)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_permissions(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_permissions(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_permissions(uuid, uuid) IS
  'School-scoped RBAC resolver (Phase 5). Same jsonb {roles, permissions} shape '
  'as the one-arg get_user_permissions(uuid); institution_admin grants resolve '
  'for p_school_id only when the caller has an active school_admins membership '
  'there. Additive overload — never weakens the one-arg baseline. Consumed by '
  'rbac.ts and school_admin_has_selected_permission.';

COMMIT;
