-- Migration: 20260614000003_phase3b_school_reporting.sql
-- Purpose: Phase 3B (School Command Center) Wave D — school-wide academic
--          REPORTING read-model layer. Ships THREE read-only SECURITY DEFINER
--          functions that power board/parent-ready school reports for school
--          admins:
--            1. get_school_mastery_rollup(school, group_by)  → per-group mastery
--               comparatives ('grade' | 'subject' | 'teacher').
--            2. get_school_bloom_summary(school)             → Bloom's distribution
--               across the school's active students' quiz_responses.
--            3. export_school_report(school)                 → one PII-SAFE jsonb
--               aggregate snapshot (overview + per-grade mastery + bloom).
--          Plus the single covering index the Bloom rollup needs that the
--          baseline does not already provide.
--
-- ─── Scope / safety contract ─────────────────────────────────────────────────
--   - READ-ONLY: no INSERT/UPDATE/DELETE, no new tables, no new RBAC
--     permissions, no writes of any kind. This is the reporting read-model only.
--   - AUTONOMOUS: read-only functions + one covering index → no CEO approval
--     gate required (matches Wave A 20260614000000).
--   - IDEMPOTENT: CREATE OR REPLACE FUNCTION, CREATE INDEX IF NOT EXISTS, and a
--     DO-block-guarded GRANT pattern. Safe to replay.
--   - SELF-CONTAINED: references only tables present in
--     00000000000000_baseline_from_prod.sql plus the unified roster helper
--     public._school_active_student_ids(uuid) shipped in this branch's Wave B
--     migration (20260614000001), which is APPLIED BEFORE this file (timestamp
--     order). No forward-references to supabase/migrations/_legacy/. Replays
--     clean on a fresh Supabase Preview branch (Wave A → Wave B → Wave C → Wave
--     D apply in order).
--
-- ─── REUSE: the ONE canonical active-student set ─────────────────────────────
-- Every function here derives "active students of a school" from the SAME
-- source of truth Wave A/B converged on:
--   public._school_active_student_ids(p_school_id uuid) RETURNS TABLE(student_id uuid)
-- = DISTINCT UNION of class_students + class_enrollments active rosters JOIN
-- active, non-deleted classes JOIN active students. So school-wide reporting
-- matches get_school_overview.student_count and the seat count EXACTLY and can
-- never drift. (Wave B migration 20260614000001, lines 180-208.)
--
-- ─── Mastery source + at-risk threshold (UNCHANGED from Wave A) ───────────────
-- Mastery is read VERBATIM from public.concept_mastery.p_know (double precision).
-- bkt_mastery_state does NOT exist in the reproducible baseline (Wave A
-- 20260614000000 confirmed this; the production-true table with the exact
-- (student_id, p_know) shape is concept_mastery, baseline line ~10661). The Wave
-- D plan-outline line that named bkt_mastery_state.p_know is corrected here to
-- the same source Wave A/B actually use, so all three waves' mastery numbers
-- agree.
-- AT_RISK_PKNOW_THRESHOLD = 0.4: a student is "at risk" when their average
-- p_know across their concept_mastery rows is BELOW 0.4 — the SAME constant and
-- the SAME per-student pre-aggregation Wave A's get_classes_at_risk uses
-- (20260614000000 line 310 / 20260614000001 line 1034). Pre-aggregating each
-- student's AVG(p_know) FIRST (per_student CTE) means a high-volume student with
-- many concept rows cannot dominate the group average — every student counts
-- once per group.
--
-- ─── Bloom source: quiz_responses (columns VERIFIED against the baseline) ─────
-- quiz_responses (baseline line 12197) has, among others:
--   student_id  uuid    NOT NULL
--   bloom_level text    (nullable; NULLs are bucketed as 'unspecified')
--   is_correct  boolean DEFAULT false   (there is NO correct_count column —
--                                         correct is derived from is_correct)
--   created_at  timestamptz DEFAULT now()
-- ADAPTATION NOTE: the goal listed a hypothetical "correct_count" column; the
-- baseline has no such column — correct counts are derived per row from the
-- boolean is_correct (count(*) FILTER (WHERE is_correct)). accuracy =
-- round(correct/total, 2). bloom_level NULL → bucketed as 'unspecified' so the
-- distribution is exhaustive (no rows silently dropped).
--
-- ─── SECURITY DEFINER + school-scope guard (cross-tenant safety) ─────────────
-- All three functions are SECURITY DEFINER so they can read mastery /
-- quiz_responses across a school's roster (both are student-scoped RLS; an admin
-- is not the student). Each function OPENS with the SAME inline guard used by
-- every Wave A/B function: the caller must be an ACTIVE school_admin of exactly
-- p_school_id, else RAISE 42501. search_path is pinned `public, pg_temp` (no
-- mutable path). EXECUTE granted to `authenticated` only (never anon / public);
-- the scope guard is the actual tenant boundary.
--
-- ─── PERFORMANCE (scalable · stable · optimum runtime) ───────────────────────
--   - Single-pass / pre-aggregated CTEs; no correlated subqueries in any
--     TABLE-returning SELECT list; no N+1 / per-row fan-out.
--   - Roster filter is index-supported: _school_active_student_ids walks
--     class_students/class_enrollments via classes(school_id)+student indexes the
--     baseline + Wave A/B already provide; concept_mastery(student_id) INCLUDE
--     p_know exists (Wave A idx_concept_mastery_student_pknow); quiz_responses
--     gets a partial (student_id, bloom_level) INCLUDE (is_correct) index below.
--   - p_group_by is validated (rejects unknown values; defaults to 'grade').
--   - O(school size), not O(all rows): every scan is school-roster-scoped first.
--
-- ─── FEATURE-FLAG GATE (caller responsibility) ───────────────────────────────
-- The Wave D UI/routes apply ff_school_reports_depth (default OFF). These SQL
-- objects existing is inert until wired; flag OFF ⇒ byte-identical portal.
--
-- ─── Schema facts relied on (verified against the baseline) ──────────────────
--   _school_active_student_ids(uuid) → TABLE(student_id uuid)   [Wave B]
--   school_admins(auth_user_id uuid, school_id uuid, is_active boolean)
--   classes(id uuid, school_id uuid, name text, grade text[P5 string],
--           section text, subject text, is_active boolean, deleted_at tstz)
--   class_students(class_id uuid, student_id uuid, is_active boolean)
--   class_enrollments(class_id uuid, student_id uuid, is_active boolean)
--   class_teachers(class_id uuid, teacher_id uuid, is_active boolean)
--   teachers(id uuid, name text, school_id uuid, is_active boolean)
--   students(id uuid, is_active boolean)
--   concept_mastery(student_id uuid, p_know double precision)
--   quiz_responses(student_id uuid, bloom_level text, is_correct boolean,
--                  created_at timestamptz)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Covering index (idempotent; only the one the baseline lacks)
-- ─────────────────────────────────────────────────────────────────────────────
-- The Bloom rollup restricts quiz_responses to the school's active student ids
-- (student_id IN (...)) and GROUPs BY bloom_level, counting is_correct. Baseline
-- already indexes quiz_responses(student_id) several ways (idx_qr_student,
-- idx_quiz_responses_student (student_id, created_at DESC),
-- idx_qr_student_correct (student_id, is_correct, created_at DESC)), so the
-- student-id roster filter is ALREADY index-supported. What the baseline does
-- NOT have is an index ordered for the (student_id → bloom_level, is_correct)
-- group-and-count, which would otherwise heap-fetch bloom_level + is_correct for
-- every matched row. This partial INCLUDE index makes the Bloom rollup
-- index-only for the bloom-tagged rows (the rows the summary actually buckets
-- by Bloom), without bloating the index with the NULL-bloom rows.
CREATE INDEX IF NOT EXISTS idx_quiz_responses_student_bloom
  ON public.quiz_responses (student_id, bloom_level)
  INCLUDE (is_correct)
  WHERE bloom_level IS NOT NULL;

-- All other join/filter columns these functions touch are already indexed by the
-- baseline + Wave A/B:
--   classes(school_id) idx_classes_school + idx_classes_school_active (Wave A)
--   class_students(class_id) idx_class_students_class + ..._class_active (Wave B)
--   class_enrollments(class_id|student_id) WHERE is_active (baseline)
--   class_teachers(class_id) idx_class_teachers_class + ..._teacher_active (WaveA)
--   teachers(school_id) idx_teachers_school_active (Wave A)
--   concept_mastery(student_id) INCLUDE p_know idx_concept_mastery_student_pknow (WaveA)
-- so nothing else is added here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_school_mastery_rollup — school-wide mastery comparatives, grouped by
--    'grade' | 'subject' | 'teacher'. Single-pass, pre-aggregated per student.
-- ─────────────────────────────────────────────────────────────────────────────
-- group_key is TEXT in every mode (grade is a STRING per P5; subject is text;
-- teacher is the teacher uuid rendered as text). group_label is human-readable
-- (grade → "Grade 7"; subject → the subject text; teacher → teacher name).
--
-- A student in multiple groups (e.g. enrolled in two different-subject classes)
-- counts in EACH relevant group — that is correct for cross-tab comparatives —
-- but is DISTINCT WITHIN a group (counted once per group). avg_mastery is the
-- AVG of per-student AVG(p_know) (pre-aggregated per student first, so a
-- high-volume student cannot dominate). at_risk_count = students in the group
-- whose per-student avg p_know < 0.4.
CREATE OR REPLACE FUNCTION public.get_school_mastery_rollup(
  p_school_id uuid,
  p_group_by  text DEFAULT 'grade'
)
RETURNS TABLE(
  group_key      text,
  group_label    text,
  student_count  bigint,
  avg_mastery    numeric,
  at_risk_count  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_by text := lower(COALESCE(p_group_by, 'grade'));
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

  -- Validate p_group_by (reject unknown → exception; never silently guess).
  IF v_group_by NOT IN ('grade', 'subject', 'teacher') THEN
    RAISE EXCEPTION 'invalid p_group_by % (expected grade | subject | teacher)', p_group_by
      USING ERRCODE = '22023';
  END IF;

  -- NOTE: inner aliases are deliberately NOT named group_key/group_label/etc —
  -- those are RETURNS TABLE OUT params and in scope throughout the body.
  RETURN QUERY
  WITH
  -- Active, non-deleted classes of the school (single scoped scan, reused below).
  sc AS (
    SELECT c.id, c.grade, c.subject
    FROM public.classes c
    WHERE c.school_id = p_school_id
      AND c.is_active
      AND c.deleted_at IS NULL
  ),
  -- UNIFIED per-class membership: DISTINCT (class_id, student_id) active via
  -- EITHER roster table, joined to active students. This is the per-class twin of
  -- _school_active_student_ids (same join conditions) so the set of students here
  -- is exactly the school's active roster, attributable to their classes.
  class_members AS (
    SELECT cs.class_id, cs.student_id
    FROM public.class_students cs
    JOIN sc ON sc.id = cs.class_id
    JOIN public.students st ON st.id = cs.student_id AND st.is_active
    WHERE cs.is_active
    UNION                       -- dedupe a student listed in both tables per class
    SELECT ce.class_id, ce.student_id
    FROM public.class_enrollments ce
    JOIN sc ON sc.id = ce.class_id
    JOIN public.students st ON st.id = ce.student_id AND st.is_active
    WHERE ce.is_active
  ),
  -- Map each (class, student) membership to its group_key/label per the chosen
  -- dimension. For 'teacher', a class can have MULTIPLE active teachers → the
  -- student is attributed to each teacher of that class (expected for cross-tab).
  -- DISTINCT (group_key, student_id) collapses a student reaching the same group
  -- via multiple classes to ONE per group.
  member_groups AS (
    SELECT DISTINCT g.group_key, g.group_label, g.student_id
    FROM (
      -- grade dimension
      SELECT
        sc.grade                                       AS group_key,
        ('Grade ' || sc.grade)                         AS group_label,
        cm.student_id                                  AS student_id
      FROM class_members cm
      JOIN sc ON sc.id = cm.class_id
      WHERE v_group_by = 'grade'
        AND sc.grade IS NOT NULL

      UNION ALL

      -- subject dimension
      SELECT
        sc.subject                                     AS group_key,
        sc.subject                                     AS group_label,
        cm.student_id                                  AS student_id
      FROM class_members cm
      JOIN sc ON sc.id = cm.class_id
      WHERE v_group_by = 'subject'
        AND NULLIF(sc.subject, '') IS NOT NULL

      UNION ALL

      -- teacher dimension (class → active teachers → teacher name)
      SELECT
        ct.teacher_id::text                            AS group_key,
        COALESCE(t.name, 'Teacher')                    AS group_label,
        cm.student_id                                  AS student_id
      FROM class_members cm
      JOIN public.class_teachers ct
        ON ct.class_id = cm.class_id AND ct.is_active
      JOIN public.teachers t
        ON t.id = ct.teacher_id AND t.is_active
      WHERE v_group_by = 'teacher'
    ) g
  ),
  -- Per-student average p_know, computed ONCE over the union of all grouped
  -- students (so a student appearing in multiple groups reuses the same average).
  -- LEFT JOIN concept_mastery so a student with no mastery rows still counts
  -- toward student_count (their avg is NULL → excluded from avg / at-risk).
  per_student AS (
    SELECT
      mg_s.student_id                AS stu_id,
      AVG(cm.p_know)                 AS student_avg_pknow
    FROM (SELECT DISTINCT student_id FROM member_groups) mg_s
    LEFT JOIN public.concept_mastery cm ON cm.student_id = mg_s.student_id
    GROUP BY mg_s.student_id
  )
  SELECT
    mg.group_key                                                    AS group_key,
    -- group_label: never NULL/empty.
    COALESCE(NULLIF(mg.group_label, ''), mg.group_key)::text        AS group_label,
    count(DISTINCT mg.student_id)::bigint                           AS student_count,
    round(AVG(ps.student_avg_pknow)::numeric, 4)                    AS avg_mastery,
    count(DISTINCT ps.stu_id) FILTER (
      WHERE ps.student_avg_pknow IS NOT NULL
        AND ps.student_avg_pknow < 0.4   -- AT_RISK_PKNOW_THRESHOLD
    )::bigint                                                       AS at_risk_count
  FROM member_groups mg
  JOIN per_student ps ON ps.stu_id = mg.student_id
  GROUP BY mg.group_key, COALESCE(NULLIF(mg.group_label, ''), mg.group_key)
  ORDER BY at_risk_count DESC, avg_mastery ASC NULLS LAST, group_key ASC;
END;
$$;

COMMENT ON FUNCTION public.get_school_mastery_rollup(uuid, text) IS
  'Phase 3B Wave D read model: school-wide mastery comparatives grouped by '
  'grade | subject | teacher (validated; default grade; unknown → 22023). Per '
  'group: group_key (text — grade is a STRING per P5; teacher is teacher uuid '
  'text), group_label, student_count (DISTINCT within group), avg_mastery (AVG of '
  'per-student AVG(concept_mastery.p_know), pre-aggregated per student so a high-'
  'volume student cannot dominate), at_risk_count (per-student avg p_know < 0.4). '
  'A student in multiple groups counts in each (expected cross-tab) but once per '
  'group. Roster = _school_active_student_ids semantics (class_students UNION '
  'class_enrollments, active classes + students). Single-pass CTEs, no N+1. '
  'SECURITY DEFINER + active-school_admin scope guard. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_school_bloom_summary — Bloom's distribution across the school's active
--    students' quiz_responses, grouped by bloom_level. Single GROUP BY.
-- ─────────────────────────────────────────────────────────────────────────────
-- Restricted to _school_active_student_ids. NULL bloom_level → 'unspecified' so
-- the distribution is exhaustive. accuracy = round(correct/total, 2) (correct
-- derived from is_correct; the baseline has no correct_count column).
CREATE OR REPLACE FUNCTION public.get_school_bloom_summary(
  p_school_id uuid
)
RETURNS TABLE(
  bloom_level    text,
  response_count bigint,
  correct_count  bigint,
  accuracy       numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- NOTE: bloom_level/response_count/etc are RETURNS TABLE OUT params; inner
  -- columns are aliased distinctly to avoid ambiguity.
  RETURN QUERY
  WITH
  -- The school's canonical active student set (single source of truth).
  roster AS (
    SELECT s.student_id
    FROM public._school_active_student_ids(p_school_id) s
  ),
  -- Quiz responses restricted to the roster, bucketed by bloom (NULL → bucket).
  resp AS (
    SELECT
      COALESCE(NULLIF(qr.bloom_level, ''), 'unspecified') AS blm,
      qr.is_correct                                       AS is_correct
    FROM public.quiz_responses qr
    JOIN roster r ON r.student_id = qr.student_id
  )
  SELECT
    resp.blm                                                       AS bloom_level,
    count(*)::bigint                                               AS response_count,
    count(*) FILTER (WHERE resp.is_correct)::bigint                AS correct_count,
    CASE
      WHEN count(*) > 0
        THEN round(
               count(*) FILTER (WHERE resp.is_correct)::numeric
               / count(*)::numeric, 2)
      ELSE 0
    END                                                           AS accuracy
  FROM resp
  GROUP BY resp.blm
  ORDER BY response_count DESC, bloom_level ASC;
END;
$$;

COMMENT ON FUNCTION public.get_school_bloom_summary(uuid) IS
  'Phase 3B Wave D read model: Bloom''s distribution across the school''s active '
  'students'' quiz_responses, grouped by bloom_level (NULL/empty → ''unspecified'' '
  'so the distribution is exhaustive). Per bucket: response_count, correct_count '
  '(derived from is_correct — baseline has no correct_count column), accuracy = '
  'round(correct/total, 2). Roster restricted to _school_active_student_ids '
  '(class_students UNION class_enrollments). Single GROUP BY, index-supported by '
  'idx_quiz_responses_student_bloom. SECURITY DEFINER + scope guard. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. export_school_report — ONE PII-SAFE jsonb aggregate snapshot, board/parent-
--    ready. AGGREGATES ONLY: no individual student names/emails/ids — only
--    group-level rows (overview counts, per-grade mastery rows, bloom buckets).
-- ─────────────────────────────────────────────────────────────────────────────
-- Reuses get_school_overview (counts + seats + avg mastery + data_state),
-- get_school_mastery_rollup('grade') (per-grade comparatives), and
-- get_school_bloom_summary (Bloom distribution). All three already scope-guard
-- internally on the SAME caller, so this wrapper guards once up front and then
-- composes. data_state: 'no_data' when the school has no active classes AND no
-- roster (no aggregate signal to report); otherwise 'live'.
CREATE OR REPLACE FUNCTION public.export_school_report(
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_overview     jsonb;
  v_grade_rows   jsonb;
  v_bloom_rows   jsonb;
  v_data_state   text;
BEGIN
  -- School-scope guard (the composed functions also guard, but fail fast here).
  IF NOT EXISTS (
    SELECT 1 FROM public.school_admins sa
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active
  ) THEN
    RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
  END IF;

  -- Overview snapshot (aggregate counts only; no PII).
  v_overview := public.get_school_overview(p_school_id);

  -- Per-grade mastery comparatives (group-level rows only; no student ids).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'grade',         r.group_key,
             'label',         r.group_label,
             'student_count', r.student_count,
             'avg_mastery',   r.avg_mastery,
             'at_risk_count', r.at_risk_count
           )
           ORDER BY r.group_key
         ), '[]'::jsonb)
    INTO v_grade_rows
  FROM public.get_school_mastery_rollup(p_school_id, 'grade') r;

  -- Bloom distribution (bucket-level rows only; no student ids).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'bloom_level',    b.bloom_level,
             'response_count', b.response_count,
             'correct_count',  b.correct_count,
             'accuracy',       b.accuracy
           )
           ORDER BY b.response_count DESC, b.bloom_level
         ), '[]'::jsonb)
    INTO v_bloom_rows
  FROM public.get_school_bloom_summary(p_school_id) b;

  -- data_state: 'no_data' when there is no aggregate signal at all.
  v_data_state := CASE
    WHEN COALESCE((v_overview->>'class_count')::int, 0) = 0
     AND COALESCE((v_overview->>'student_count')::int, 0) = 0
     AND jsonb_array_length(v_grade_rows) = 0
     AND jsonb_array_length(v_bloom_rows) = 0
      THEN 'no_data'
    ELSE 'live'
  END;

  RETURN jsonb_build_object(
    'school_id',     p_school_id,
    'overview',      v_overview,
    'mastery_by_grade', v_grade_rows,
    'bloom_summary', v_bloom_rows,
    'data_state',    v_data_state,
    'generated_at',  now()
  );
END;
$$;

COMMENT ON FUNCTION public.export_school_report(uuid) IS
  'Phase 3B Wave D read model: ONE PII-SAFE board/parent-ready jsonb aggregate '
  'snapshot — { school_id, overview (reuse get_school_overview counts), '
  'mastery_by_grade (group-level rows from get_school_mastery_rollup(grade)), '
  'bloom_summary (bucket rows from get_school_bloom_summary), data_state, '
  'generated_at }. AGGREGATES ONLY: no individual student names/emails/ids — only '
  'group-level rows. data_state ''no_data'' when no active classes/roster/signal. '
  'SECURITY DEFINER + active-school_admin scope guard. Read-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Grants (idempotent, DO-block guarded) — authenticated only; the inline
--    scope guard on every function is the real tenant boundary.
-- ─────────────────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_mastery_rollup(uuid, text) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_mastery_rollup(uuid, text) FROM anon';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.get_school_mastery_rollup(uuid, text) TO authenticated';

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_bloom_summary(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_bloom_summary(uuid) FROM anon';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.get_school_bloom_summary(uuid) TO authenticated';

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.export_school_report(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.export_school_report(uuid) FROM anon';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.export_school_report(uuid) TO authenticated';
END;
$grant$;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- As a school admin of <school_uuid> (authenticated):
--   SELECT * FROM public.get_school_mastery_rollup('<school_uuid>');            -- default grade
--   SELECT * FROM public.get_school_mastery_rollup('<school_uuid>', 'subject');
--   SELECT * FROM public.get_school_mastery_rollup('<school_uuid>', 'teacher');
--   SELECT public.get_school_mastery_rollup('<school_uuid>', 'bogus');          -- RAISES 22023
--   SELECT * FROM public.get_school_bloom_summary('<school_uuid>');
--   SELECT public.export_school_report('<school_uuid>');                        -- PII-safe jsonb
-- As a non-admin (or admin of another school): each RAISES 42501.
-- Parity: export_school_report.overview.student_count equals
--   public._count_active_school_students('<school_uuid>') (same roster source).
