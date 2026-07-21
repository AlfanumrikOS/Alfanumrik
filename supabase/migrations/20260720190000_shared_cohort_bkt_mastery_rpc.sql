-- Migration: 20260720190000_shared_cohort_bkt_mastery_rpc.sql
-- Purpose: T8 (Teacher Dashboard Redesign & Remediation) — unify the mastery
--          FORMULA used by teacher Reports, the School-Admin Command Center,
--          and super-admin B2B analytics onto ONE Postgres function, so the
--          same cohort always produces the same mastery number no matter
--          which surface asks for it.
--
-- ─── Background (RCA) ─────────────────────────────────────────────────────
-- Three independent aggregation formulas existed for the same underlying
-- data:
--   1. Teacher Reports (get_class_overview/get_class_trends/get_student_report
--      in supabase/functions/teacher-dashboard/index.ts) used an
--      ACCURACY-AS-MASTERY PROXY off student_learning_profiles
--      (total_questions_asked/correct) — explicitly commented in that file as
--      a stand-in "without a true BKT roll-up at this aggregation layer."
--   2. School-Admin Command Center (get_school_overview / get_classes_at_risk
--      / get_teacher_engagement, migration 20260614000000) used a real BKT
--      AVG(concept_mastery.p_know) roll-up — the most rigorous of the three.
--   3. Super-admin B2B analytics (apps/host/src/app/api/super-admin/
--      analytics-v2/b2b/route.ts) used a THIRD, unrelated weighted formula
--      (engagementRate*0.4 + avgScore*0.3 + seatUtilization*0.3) computed
--      from raw REST reads, blending non-mastery signals (seat utilization,
--      revenue-adjacent inputs) that legitimately do not belong in a pure
--      mastery number.
--
-- ─── Design decision ──────────────────────────────────────────────────────
-- The BKT p_know roll-up (#2) is the most rigorous and becomes the single
-- source of truth. It is extracted into a new, parameterized, reusable
-- function — calculate_cohort_bkt_mastery(uuid[]) — that takes an explicit,
-- ALREADY-AUTHORIZED array of student ids and returns the cohort's average
-- BKT mastery. Per-student breakdown is exposed via a companion table
-- function, get_cohort_bkt_mastery_by_student(uuid[]).
--
-- Why not just have every caller invoke get_school_overview() directly?
-- get_school_overview/get_classes_at_risk/get_teacher_engagement are
-- SECURITY DEFINER functions that internally verify the CALLER is an active
-- school_admin of p_school_id via `auth.uid()`. That guard only makes sense
-- for a caller with a real end-user JWT session (the Next.js school-admin
-- route, which forwards the signed-in admin's session to `supabase.rpc()`).
-- The teacher-dashboard Edge Function and the super-admin B2B route both
-- call Postgres with the SERVICE-ROLE key — under service_role, `auth.uid()`
-- is NULL, so calling get_school_overview() from either of those runtimes
-- would always raise 42501, even for a fully-authorized request. Those two
-- callers already do their OWN application-level authorization before this
-- point (teacher-dashboard: assertTeacherOwnsClass / resolveStudentsForTeacher;
-- super-admin B2B: authorizeAdmin(request, 'support')) — exactly mirroring
-- how they already query `concept_mastery` directly with the service-role
-- client today. So the new functions intentionally do NOT re-implement an
-- auth.uid() guard; they trust the caller has already resolved an authorized
-- student_id set, exactly like the raw table reads they replace. This is not
-- a new privilege-escalation path: EXECUTE is granted ONLY to `service_role`
-- (never `authenticated`/`anon`), so no browser-held JWT can invoke it
-- directly with an arbitrary student_id array — the same trust boundary the
-- Edge Function's existing direct `concept_mastery` service-role reads
-- already relied on.
--
-- get_school_overview (Next.js school-admin surface, real end-user session)
-- keeps its own `auth.uid()` scope guard and is refactored to CALL the new
-- shared function internally for its avg_mastery computation, once its own
-- guard has already passed and it has resolved its authorized roster. This
-- makes it truly one formula in one place: the school-admin RPC is now the
-- reference caller of the same primitive the other two surfaces call
-- directly.
--
-- get_classes_at_risk is a per-class GROUP BY breakdown (a different output
-- shape, not a single cohort number) and get_teacher_engagement does not
-- compute mastery at all — neither is touched here.
--
-- Super-admin B2B's weighted health_score formula legitimately blends
-- non-mastery signals (seat utilization, revenue-adjacent inputs) that do
-- not belong in a pure mastery metric — see the P8/9 boundary discussion in
-- .claude/CLAUDE.md's task instructions. Rather than force a bad merge, the
-- B2B route is updated (in application code, not this migration) to ALSO
-- surface `avg_bkt_mastery` per school, computed via this SAME shared
-- function, as one clearly-labeled additional field alongside its existing
-- (unmodified) health_score — not folded into health_score's weights.
--
-- ─── Safety contract ──────────────────────────────────────────────────────
--   - READ-ONLY: no INSERT/UPDATE/DELETE, no new tables, no new RBAC
--     permissions.
--   - IDEMPOTENT: CREATE OR REPLACE FUNCTION, idempotent GRANT.
--   - SECURITY DEFINER (STABLE) so it can read concept_mastery across
--     students (concept_mastery RLS is student-self-only). EXECUTE is
--     granted ONLY to `service_role` — never `authenticated`/`anon` — so a
--     browser-held session cannot call it directly with someone else's
--     student ids. search_path is pinned to `public, pg_temp`.
--   - No RLS/RBAC boundary is weakened: every existing caller's own
--     authorization check (teacher ownership resolution, school_admin
--     auth.uid() guard, authorizeAdmin('support')) remains fully intact and
--     runs BEFORE the student_id array reaches this function.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. get_cohort_bkt_mastery_by_student — per-student avg BKT p_know for an
--    explicit, caller-authorized student id array. This is the shared
--    primitive: every other function/route in this migration's story
--    ultimately traces back to this SELECT.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cohort_bkt_mastery_by_student(
  p_student_ids uuid[]
)
RETURNS TABLE(
  student_id       uuid,
  avg_pknow        numeric,
  avg_mastery_pct  int,
  sample_count     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    cm.student_id,
    round(AVG(cm.p_know)::numeric, 4)          AS avg_pknow,
    round(AVG(cm.p_know)::numeric * 100)::int  AS avg_mastery_pct,
    count(*)::bigint                           AS sample_count
  FROM public.concept_mastery cm
  WHERE cm.student_id = ANY(COALESCE(p_student_ids, ARRAY[]::uuid[]))
  GROUP BY cm.student_id;
$$;

COMMENT ON FUNCTION public.get_cohort_bkt_mastery_by_student(uuid[]) IS
  'T8 shared mastery primitive: per-student average BKT p_know (as a 0..1 '
  'fraction and a rounded 0..100 percent) across concept_mastery, for an '
  'explicit, ALREADY-AUTHORIZED student_id array. Trusts the caller to have '
  'resolved authorization (teacher ownership / school_admin scope / '
  'super-admin authorizeAdmin) before invoking. SECURITY DEFINER so it can '
  'read across students; EXECUTE granted to service_role only (never '
  'authenticated/anon) — same trust boundary as the direct concept_mastery '
  'service-role reads it replaces. Read-only. Students with no '
  'concept_mastery rows are simply absent from the result (no row), letting '
  'callers distinguish "no BKT signal yet" from "0% mastery".';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. calculate_cohort_bkt_mastery — single aggregate avg mastery percent for
--    an explicit, caller-authorized student id array. Thin wrapper over #1
--    so a caller that only wants "one number for this cohort" (e.g. the
--    super-admin B2B route, or get_school_overview below) doesn't have to
--    re-derive the aggregate itself.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_cohort_bkt_mastery(
  p_student_ids uuid[]
)
RETURNS TABLE(
  student_count    bigint,
  scored_count     bigint,
  avg_pknow        numeric,
  avg_mastery_pct  int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    cardinality(COALESCE(p_student_ids, ARRAY[]::uuid[]))::bigint AS student_count,
    count(*)::bigint                                              AS scored_count,
    round(AVG(m.avg_pknow)::numeric, 4)                           AS avg_pknow,
    round(AVG(m.avg_pknow)::numeric * 100)::int                   AS avg_mastery_pct
  FROM public.get_cohort_bkt_mastery_by_student(p_student_ids) m;
$$;

COMMENT ON FUNCTION public.calculate_cohort_bkt_mastery(uuid[]) IS
  'T8 shared mastery primitive: single cohort-wide average BKT mastery '
  '(0..100 percent) for an explicit, ALREADY-AUTHORIZED student_id array. '
  'Thin aggregate wrapper over get_cohort_bkt_mastery_by_student — the ONE '
  'formula shared by teacher Reports (supabase/functions/teacher-dashboard/'
  'index.ts), get_school_overview below, and the super-admin B2B route '
  '(apps/host/src/app/api/super-admin/analytics-v2/b2b/route.ts). '
  'student_count is the size of the input array (roster size); scored_count '
  'is how many of them have at least one concept_mastery row — the gap '
  'between the two is honest "no BKT signal yet" coverage, not silently '
  'folded into a lower average. SECURITY DEFINER; EXECUTE granted to '
  'service_role only. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Refactor get_school_overview to call the shared primitive for its
--    avg_mastery field, instead of its own inline AVG(p_know) CTE. Same
--    auth guard, same roster resolution, same output shape/values —
--    formula now delegates to the shared function so there is one formula
--    in one place.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_school_overview(p_school_id uuid)
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
  -- Active classes in the school.
  school_classes AS (
    SELECT c.id
    FROM public.classes c
    WHERE c.school_id = p_school_id
      AND c.is_active
      AND c.deleted_at IS NULL
  ),
  -- Distinct active students on those classes' rosters.
  active_roster AS (
    SELECT DISTINCT cs.student_id
    FROM public.class_students cs
    JOIN school_classes sc ON sc.id = cs.class_id
    JOIN public.students st ON st.id = cs.student_id
    WHERE cs.is_active
      AND st.is_active
  ),
  -- Distinct active teachers assigned to those classes.
  active_teachers AS (
    SELECT DISTINCT ct.teacher_id
    FROM public.class_teachers ct
    JOIN school_classes sc ON sc.id = ct.class_id
    WHERE ct.is_active
  ),
  -- Latest seat-usage snapshot for the school (one row).
  latest_seat AS (
    SELECT su.seats_purchased, su.active_students, su.utilization_pct
    FROM public.school_seat_usage su
    WHERE su.school_id = p_school_id
    ORDER BY su.snapshot_date DESC
    LIMIT 1
  ),
  -- Subscription fallback for seats_purchased when no snapshot exists.
  sub_seats AS (
    SELECT ss.seats_purchased
    FROM public.school_subscriptions ss
    WHERE ss.school_id = p_school_id
      AND ss.status = 'active'
    ORDER BY ss.seats_purchased DESC NULLS LAST
    LIMIT 1
  ),
  -- Cohort-wide average BKT mastery for the school's active roster, via the
  -- shared T8 primitive (same formula every other caller uses).
  mastery AS (
    SELECT avg_pknow
    FROM public.calculate_cohort_bkt_mastery(
      (SELECT array_agg(student_id) FROM active_roster)
    )
  )
  SELECT jsonb_build_object(
    'class_count',         (SELECT count(*) FROM school_classes),
    'teacher_count',       (SELECT count(*) FROM active_teachers),
    'student_count',       (SELECT count(*) FROM active_roster),
    'seats_purchased',     COALESCE(
                             (SELECT seats_purchased FROM latest_seat),
                             (SELECT seats_purchased FROM sub_seats),
                             0),
    'active_students',     COALESCE(
                             (SELECT active_students FROM latest_seat),
                             (SELECT count(*) FROM active_roster)),
    'seat_utilization_pct', CASE
      WHEN (SELECT utilization_pct FROM latest_seat) IS NOT NULL
        THEN round((SELECT utilization_pct FROM latest_seat)::numeric, 2)
      WHEN COALESCE((SELECT seats_purchased FROM latest_seat),
                    (SELECT seats_purchased FROM sub_seats), 0) > 0
        THEN round(
               ((SELECT count(*) FROM active_roster)::numeric
                / COALESCE((SELECT seats_purchased FROM latest_seat),
                           (SELECT seats_purchased FROM sub_seats))::numeric) * 100,
               2)
      ELSE NULL
    END,
    'avg_mastery',         (SELECT avg_pknow FROM mastery),
    -- data_state hint so the UI never fakes numbers: 'no_data' iff the school
    -- has no active classes AND no roster AND no mastery signal.
    'data_state',          CASE
      WHEN (SELECT count(*) FROM school_classes) = 0
       AND (SELECT count(*) FROM active_roster) = 0
       AND (SELECT avg_pknow FROM mastery) IS NULL
        THEN 'no_data'
      ELSE 'live'
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_school_overview(uuid) IS
  'Phase 3B Wave A read model: one-pass jsonb snapshot of a school (class/teacher/'
  'student counts, seats, seat utilization, avg BKT mastery, data_state hint). '
  'SECURITY DEFINER with an internal active-school_admin scope guard. '
  'T8 (2026-07-20): avg_mastery now delegates to the shared '
  'calculate_cohort_bkt_mastery(uuid[]) primitive instead of its own inline '
  'AVG(p_know) CTE — same formula, same value, now defined in one place and '
  'reused by teacher Reports and super-admin B2B analytics too. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Grants (idempotent). service_role for the two new shared primitives —
--    only server-held service-role callers (teacher-dashboard Edge Function,
--    super-admin B2B route) may invoke them directly. authenticated keeps
--    its existing grant on get_school_overview (unchanged).
-- ─────────────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_cohort_bkt_mastery_by_student(uuid[]) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.calculate_cohort_bkt_mastery(uuid[]) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_school_overview(uuid) TO authenticated';
END;
$grant$;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────
--   -- As service_role:
--   SELECT * FROM public.get_cohort_bkt_mastery_by_student(ARRAY['<student-uuid>']::uuid[]);
--   SELECT * FROM public.calculate_cohort_bkt_mastery(ARRAY['<student-uuid>']::uuid[]);
--   -- As a school admin of <school_uuid> (unchanged behavior, now delegating):
--   SELECT public.get_school_overview('<school_uuid>');
--   -- As `authenticated` (not service_role), directly invoking either new
--   -- shared function must fail with "permission denied for function ...".
