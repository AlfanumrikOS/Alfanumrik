-- supabase/migrations/20260415000010_subject_violations_rpc.sql
--
-- Purpose-built RPC for the super-admin violations dashboard. Replaces:
--   (a) the broken `exec_admin_query` CTE path in
--       src/app/api/super-admin/subjects/violations/route.ts (which called a
--       non-existent RPC that executes arbitrary SQL — security-sensitive
--       design rejected), and
--   (b) the buggy per-student fallback in the same route, which read
--       `subject_code` from `get_available_subjects` (actual field: `code`)
--       and `is_locked` from `student_subject_enrollment` (column doesn't
--       exist). Both bugs silently produced wrong dashboards.
--
-- Definition: a violation is a row in student_subject_enrollment whose
-- subject_code is NOT in the student's current (grade ∩ plan ∩ stream)
-- allowlist.
--
-- Security: SECURITY DEFINER, execute granted only to service_role. Admin
-- routes use supabaseAdmin (service role) to call this. Never exposed to
-- authenticated users directly.
--
-- Idempotent: CREATE OR REPLACE.
--
-- Applied to production 2026-04-15 via mcp apply_migration; file committed
-- for CI parity.

BEGIN;

CREATE OR REPLACE FUNCTION get_subject_violations(
  p_plan text DEFAULT NULL,
  p_grade text DEFAULT NULL,
  p_stream text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  student_id uuid,
  grade text,
  stream text,
  plan text,
  invalid_subjects text[],
  total int,
  total_count bigint
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH student_ctx AS (
    SELECT
      s.id AS sid,
      s.grade,
      s.stream,
      COALESCE(
        (SELECT plan_code FROM student_subscriptions
          WHERE student_id = s.id
            AND status IN ('active','trialing','grace')
          ORDER BY current_period_end DESC NULLS LAST LIMIT 1),
        'free'
      ) AS plan_code
    FROM students s
    WHERE (p_grade IS NULL OR s.grade = p_grade)
  ),
  filtered AS (
    SELECT * FROM student_ctx
     WHERE (p_plan   IS NULL OR plan_code = p_plan)
       AND (p_stream IS NULL OR COALESCE(stream,'none') = p_stream)
  ),
  allowed AS (
    SELECT
      f.sid,
      ARRAY_AGG(DISTINCT gsm.subject_code) FILTER (WHERE psa.subject_code IS NOT NULL) AS codes
    FROM filtered f
    JOIN grade_subject_map gsm
      ON gsm.grade = f.grade
     AND (gsm.stream IS NULL OR gsm.stream = f.stream OR f.stream IS NULL)
    LEFT JOIN plan_subject_access psa
      ON psa.plan_code = f.plan_code
     AND psa.subject_code = gsm.subject_code
    GROUP BY f.sid
  ),
  enrolled AS (
    SELECT
      sse.student_id AS sid,
      ARRAY_AGG(sse.subject_code) AS codes
    FROM student_subject_enrollment sse
    WHERE sse.student_id IN (SELECT sid FROM filtered)
    GROUP BY sse.student_id
  ),
  v AS (
    SELECT
      f.sid AS student_id,
      f.grade,
      f.stream,
      f.plan_code AS plan,
      COALESCE(
        ARRAY(
          SELECT UNNEST(e.codes)
          EXCEPT
          SELECT UNNEST(COALESCE(a.codes, ARRAY[]::text[]))
        ),
        ARRAY[]::text[]
      ) AS invalid
    FROM filtered f
    LEFT JOIN allowed  a USING (sid)
    LEFT JOIN enrolled e ON e.sid = f.sid
    WHERE e.codes IS NOT NULL
  ),
  flagged AS (
    SELECT * FROM v WHERE array_length(invalid, 1) > 0
  )
  SELECT
    student_id, grade, stream, plan, invalid AS invalid_subjects,
    COALESCE(array_length(invalid, 1), 0) AS total,
    COUNT(*) OVER () AS total_count
  FROM flagged
  ORDER BY array_length(invalid, 1) DESC, student_id ASC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION get_subject_violations(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_subject_violations(text, text, text, int, int) TO service_role;

COMMIT;