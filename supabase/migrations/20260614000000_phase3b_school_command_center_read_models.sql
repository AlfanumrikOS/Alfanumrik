-- Migration: 20260614000000_phase3b_school_command_center_read_models.sql
-- Purpose: Phase 3B (School Command Center) Wave A — the read-model layer.
--          Ships THREE read-only SECURITY DEFINER functions that power a
--          read-only School Command Center for school admins:
--            1. get_school_overview(p_school_id)      → one jsonb snapshot.
--            2. get_classes_at_risk(p_school_id,...)  → per-class risk rollup.
--            3. get_teacher_engagement(p_school_id,…) → per-teacher activity.
--          Plus idempotent covering indexes for the join/filter columns the
--          functions hit that the baseline does not already provide.
--
-- ─── Scope / safety contract ─────────────────────────────────────────────────
--   - READ-ONLY: no INSERT/UPDATE/DELETE, no new tables, no new RBAC
--     permissions, no writes of any kind. This is the read-model layer only.
--   - AUTONOMOUS: per the /goal this is autonomous work (read-only functions +
--     covering indexes), so no CEO approval gate is required.
--   - IDEMPOTENT: CREATE OR REPLACE FUNCTION, CREATE INDEX IF NOT EXISTS, and a
--     DO-block-guarded GRANT pattern. Safe to replay.
--   - SELF-CONTAINED: references only tables present in
--     00000000000000_baseline_from_prod.sql (no forward-references to
--     supabase/migrations/_legacy/). Replays clean on a fresh Preview branch.
--
-- ─── SECURITY DEFINER + school-scope guard (cross-tenant safety) ─────────────
-- All three functions are SECURITY DEFINER so they can read mastery across a
-- school's roster (concept_mastery is student-scoped RLS; an admin is not the
-- student). To stop SECURITY DEFINER from leaking cross-school data, each
-- function OPENS with an internal guard that the caller is an ACTIVE
-- school_admin of exactly p_school_id, else it raises 42501. search_path is
-- pinned to `public, pg_temp` on every function (no mutable search_path),
-- mirroring 20260516010000_fix_function_search_path_mutable.sql. EXECUTE is
-- granted to `authenticated` only (never anon / public).
--
-- ─── At-risk threshold constant ──────────────────────────────────────────────
-- AT_RISK_PKNOW_THRESHOLD = 0.4 on concept_mastery.p_know. A student is "at
-- risk" on the school rollup when their average BKT p_know across their
-- concept_mastery rows is BELOW 0.4. The 0.4 cutoff is the established BKT
-- mastery floor across the codebase, on the SAME p_know metric this rollup uses:
--   - src/lib/cognitive-engine.ts:925 — error classification treats
--     `studentMastery < 0.4` (on a hard question) as a CONCEPTUAL gap.
--   - src/lib/cognitive-engine.ts:1465 — mastery `>= 0.4` is the "developing"
--     floor; below 0.4 is "building", i.e. not-yet-developing / at risk.
--   - 00000000000000_baseline_from_prod.sql:3949 — the study-plan RPC
--     generate_daily_plan flags weak topics at `mastery_probability < 0.4`, and
--     the BKT writer keeps concept_mastery.mastery_probability = p_know in
--     lockstep, so `< 0.4` there is the same p_know cutoff used here.
-- NOTE: the accuracy-based teacher-dashboard alert bands (e.g. `mastery < 40`,
-- and the <30%/<50% recommendation tiers in
-- supabase/functions/teacher-dashboard/index.ts) are a DIFFERENT metric —
-- question-accuracy percent off student_learning_profiles, NOT BKT p_know — and
-- must not be conflated with this BKT-p_know at-risk rollup. The Phase 3A
-- migration (20260613000004) did NOT encode an at-risk constant in SQL — it left
-- at-risk semantics to the Edge resolver — so there is no prior SQL constant to
-- contradict; 0.4 is the faithful SQL twin of the established BKT p_know floor.
--
-- ─── Schema facts relied on (verified against the baseline) ──────────────────
--   school_admins(auth_user_id uuid, school_id uuid, is_active boolean)
--   schools(id uuid)
--   classes(id uuid, school_id uuid, name text, grade text[P5 string], section text,
--           subject text, is_active boolean, deleted_at timestamptz)
--   class_students(class_id uuid, student_id uuid, is_active boolean)
--   class_teachers(class_id uuid, teacher_id uuid, is_active boolean)
--   teachers(id uuid, name text, school_id uuid, is_active boolean)
--   students(id uuid, is_active boolean)
--   school_seat_usage(school_id uuid, snapshot_date date, active_students int,
--                     seats_purchased int, utilization_pct numeric)
--   school_subscriptions(school_id uuid, seats_purchased int, status text)
--   teacher_remediation_assignments(teacher_id uuid, student_id uuid,
--                     class_id uuid, status text)  [from 20260613000004]
--
-- ─── ADAPTATION: bkt_mastery_state → concept_mastery ─────────────────────────
-- The /goal and the Phase 3A migration's comment refer to a `bkt_mastery_state`
-- table with a `p_know` column keyed by (student_id, topic_id). That table does
-- NOT exist in the reproducible baseline (00000000000000_baseline_from_prod.sql)
-- and is NOT created by any root migration; the teacher-dashboard Edge Function
-- queries it inside a try/catch that fails soft to empty. The production-true
-- table with the EXACT shape (student_id, topic_id, p_know double precision,
-- attempts, mastery_level) is `public.concept_mastery` (baseline line ~10661;
-- the BKT RPC bkt_update_personalized writes p_know/mastery_probability there).
-- To replay clean on a fresh Preview branch we therefore read AVG(p_know) from
-- public.concept_mastery. If a future env materializes a real bkt_mastery_state
-- view/table, swap the source in a follow-up — the function signatures here are
-- the stable contract.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Covering indexes (idempotent; only those the baseline lacks)
-- ─────────────────────────────────────────────────────────────────────────────
-- Baseline already provides (verified): idx_class_students_class (class_id),
-- idx_class_students_student (student_id), idx_class_teachers_class (class_id),
-- idx_class_teachers_teacher (teacher_id), idx_classes_school (school_id),
-- idx_concept_mastery_student (student_id), idx_seat_usage_school_date
-- (school_id, snapshot_date DESC), school_subscriptions_school_idx (school_id),
-- and (from 20260613000004) idx_teacher_remediation_assignments_teacher_status
-- (teacher_id, status). Those are NOT re-created here.
--
-- We add only the partial/active-scoped covering indexes that materially help
-- these read models and are missing in the baseline.

-- classes filtered by school + active (overview class_count, at-risk rollup).
-- Partial index keeps it small and exactly matches the WHERE is_active filter.
CREATE INDEX IF NOT EXISTS idx_classes_school_active
  ON public.classes (school_id)
  WHERE is_active;

-- class_teachers joined by teacher, active only (teacher engagement class_count).
CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher_active
  ON public.class_teachers (teacher_id)
  WHERE is_active;

-- teachers filtered by school + active (teacher engagement base set).
CREATE INDEX IF NOT EXISTS idx_teachers_school_active
  ON public.teachers (school_id)
  WHERE is_active;

-- concept_mastery covering (student_id) INCLUDE p_know so the school mastery
-- avg + at-risk rollup is index-only and never widens to a heap fetch per row.
CREATE INDEX IF NOT EXISTS idx_concept_mastery_student_pknow
  ON public.concept_mastery (student_id)
  INCLUDE (p_know);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_school_overview — one-pass jsonb snapshot for the Command Center home
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- Average BKT p_know across the school's active roster (null if none).
  mastery AS (
    SELECT AVG(cm.p_know)::numeric AS avg_pknow
    FROM public.concept_mastery cm
    JOIN active_roster ar ON ar.student_id = cm.student_id
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
    'avg_mastery',         (SELECT round(avg_pknow, 4) FROM mastery),
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
  'SECURITY DEFINER with an internal active-school_admin scope guard. Reads '
  'AVG(concept_mastery.p_know) for mastery (bkt_mastery_state is absent in the '
  'reproducible baseline). Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_classes_at_risk — per-class risk rollup (single GROUP BY)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_classes_at_risk(
  p_school_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  class_id       uuid,
  class_name     text,
  grade          text,
  student_count  bigint,
  at_risk_count  bigint,
  avg_mastery    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);  -- clamp 1..100
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  -- School-scope guard.
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- NOTE: inner aliases are deliberately NOT named class_id/class_name/grade —
  -- those names are RETURNS TABLE OUT params and in scope throughout the body,
  -- so reusing them as column aliases risks "column reference is ambiguous".
  RETURN QUERY
  WITH
  -- Per (class, student) average p_know, computed once. LEFT JOIN concept_mastery
  -- so students with no mastery rows still count toward student_count (their
  -- per-student avg is NULL and is excluded from the at-risk / avg aggregates).
  per_student AS (
    SELECT
      c.id                       AS cls_id,
      c.name                     AS cls_name,
      c.grade                    AS cls_grade,
      c.section                  AS cls_section,
      c.subject                  AS cls_subject,
      cs.student_id              AS stu_id,
      AVG(cm.p_know)             AS student_avg_pknow
    FROM public.classes c
    JOIN public.class_students cs ON cs.class_id = c.id AND cs.is_active
    JOIN public.students st       ON st.id = cs.student_id AND st.is_active
    LEFT JOIN public.concept_mastery cm ON cm.student_id = cs.student_id
    WHERE c.school_id = p_school_id
      AND c.is_active
      AND c.deleted_at IS NULL
    GROUP BY c.id, c.name, c.grade, c.section, c.subject, cs.student_id
  )
  SELECT
    ps.cls_id                                                      AS class_id,
    -- class_name: name + section + subject as available, never NULL.
    trim(BOTH ' ' FROM
      COALESCE(ps.cls_name, 'Class')
      || COALESCE(' - ' || NULLIF(ps.cls_section, ''), '')
      || COALESCE(' (' || NULLIF(ps.cls_subject, '') || ')', '')
    )::text                                                        AS class_name,
    ps.cls_grade                                                   AS grade,
    count(*)::bigint                                               AS student_count,
    count(*) FILTER (
      WHERE ps.student_avg_pknow IS NOT NULL
        AND ps.student_avg_pknow < 0.4   -- AT_RISK_PKNOW_THRESHOLD
    )::bigint                                                      AS at_risk_count,
    round(AVG(ps.student_avg_pknow)::numeric, 4)                   AS avg_mastery
  FROM per_student ps
  GROUP BY ps.cls_id, ps.cls_name, ps.cls_section, ps.cls_subject, ps.cls_grade
  ORDER BY at_risk_count DESC, avg_mastery ASC NULLS LAST
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.get_classes_at_risk(uuid, int, int) IS
  'Phase 3B Wave A read model: per-class risk rollup (student_count, at_risk_count '
  'where avg p_know < 0.4, avg_mastery) for a school, single GROUP BY over '
  'classes x class_students x concept_mastery. Ordered at_risk_count DESC, '
  'avg_mastery ASC. p_limit clamped to 100. SECURITY DEFINER + scope guard. '
  'Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_teacher_engagement — per-teacher activity (single-pass joins)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_teacher_engagement(
  p_school_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  teacher_id                  uuid,
  teacher_name                text,
  class_count                 bigint,
  remediation_assigned_count  bigint,
  remediation_resolved_count  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);  -- clamp 1..100
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  -- School-scope guard.
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- NOTE: inner aliases are deliberately NOT named teacher_id/teacher_name —
  -- those names are RETURNS TABLE OUT params and in scope throughout the body.
  RETURN QUERY
  WITH
  -- Active teachers of the school (base set; LEFT JOINed against activity so a
  -- teacher with zero remediation still appears).
  school_teachers AS (
    SELECT t.id AS tch_id, t.name AS tch_name
    FROM public.teachers t
    WHERE t.school_id = p_school_id
      AND t.is_active
  ),
  -- Distinct active class assignments per teacher (pre-aggregated, no fan-out).
  class_counts AS (
    SELECT ct.teacher_id AS tch_id, count(DISTINCT ct.class_id) AS class_count
    FROM public.class_teachers ct
    JOIN school_teachers stc ON stc.tch_id = ct.teacher_id
    WHERE ct.is_active
    GROUP BY ct.teacher_id
  ),
  -- Remediation rollup per teacher (pre-aggregated, no fan-out into the join).
  remediation AS (
    SELECT
      tra.teacher_id                                    AS tch_id,
      count(*)                                          AS assigned_count,
      count(*) FILTER (WHERE tra.status = 'resolved')   AS resolved_count
    FROM public.teacher_remediation_assignments tra
    JOIN school_teachers stt ON stt.tch_id = tra.teacher_id
    GROUP BY tra.teacher_id
  )
  SELECT
    stf.tch_id                                    AS teacher_id,
    COALESCE(stf.tch_name, 'Teacher')::text       AS teacher_name,
    COALESCE(cc.class_count, 0)::bigint           AS class_count,
    COALESCE(r.assigned_count, 0)::bigint         AS remediation_assigned_count,
    COALESCE(r.resolved_count, 0)::bigint         AS remediation_resolved_count
  FROM school_teachers stf
  LEFT JOIN class_counts cc ON cc.tch_id = stf.tch_id
  LEFT JOIN remediation r   ON r.tch_id = stf.tch_id
  ORDER BY remediation_assigned_count DESC, teacher_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.get_teacher_engagement(uuid, int, int) IS
  'Phase 3B Wave A read model: per-teacher activity (class_count, '
  'remediation_assigned_count, remediation_resolved_count) for a school via '
  'pre-aggregated single-pass joins. Ordered remediation_assigned_count DESC. '
  'p_limit clamped to 100. SECURITY DEFINER + scope guard. Read-only. NOTE: '
  'last_active is omitted — no cheap, reliable per-teacher activity timestamp '
  'exists in the baseline (teachers has no last_active/last_login column and '
  'teacher_remediation_assignments has only created_at/resolved_at, which would '
  'mis-represent engagement). Add when a real signal lands.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Grants (idempotent) — authenticated only; the scope guard does the rest.
-- ─────────────────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_school_overview(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_classes_at_risk(uuid, int, int) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_teacher_engagement(uuid, int, int) TO authenticated';
END;
$grant$;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- As a school admin of <school_uuid>:
--   SELECT public.get_school_overview('<school_uuid>');
--   SELECT * FROM public.get_classes_at_risk('<school_uuid>', 20, 0);
--   SELECT * FROM public.get_teacher_engagement('<school_uuid>', 20, 0);
-- As a non-admin (or admin of another school): each must RAISE 42501.
