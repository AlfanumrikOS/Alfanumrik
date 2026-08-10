-- Migration: 20260814000011_get_subject_violations_active_aware.sql
-- Phase 3 / M6 — Server-authoritative allowed-subject policy: verification.
--
-- Purpose
--   Make the primary verification signal for this whole phase mean something.
--
--   get_subject_violations() builds its `allowed` set from grade_subject_map
--   ⋈ plan_subject_access and never joins subjects. It therefore ignores
--   is_active entirely. After an is_active-only flip it would report ZERO
--   violations while students are still enrolled in removed subjects — a
--   clean-looking dashboard over a dirty database. Anyone verifying M1 with
--   this RPC before this migration lands gets a false all-clear.
--
-- Change
--   One INNER JOIN to subjects inside the `allowed` CTE, gated on
--   sub.is_active. Everything else — signature, return shape, filters,
--   ordering, pagination — is byte-identical to the baseline definition.
--   A student whose entire grade map is now inactive simply drops out of
--   `allowed`; the existing LEFT JOIN in `v` then COALESCEs a.codes to an
--   empty array and every enrolled code is correctly reported invalid.
--
-- SECURITY DEFINER justification (required by the architect migration rules):
--   This is an admin forensic read model — it must scan students,
--   student_subscriptions and student_subject_enrollment across the entire
--   tenant to be a violation report at all. As SECURITY INVOKER it would
--   return only the caller's own RLS-visible rows and therefore always look
--   clean, which is precisely the failure mode this migration exists to fix.
--   It is STABLE (read-only), returns UUIDs and subject codes only (no PII),
--   pins search_path, and EXECUTE is revoked from PUBLIC/anon/authenticated
--   and granted to service_role alone.
--
--   Grant note: 20260510033000 once granted EXECUTE to `authenticated`;
--   20260516040000 revoked it again. The revokes below re-assert the LATER
--   (current) posture — service_role only — because they must be restated
--   after any CREATE OR REPLACE that could otherwise leave a stale ACL
--   assumption undocumented.
--
--   `SET search_path = public, pg_catalog` is restated for the same reason as
--   in M5: CREATE OR REPLACE FUNCTION discards the function's SET clauses, so
--   omitting it would silently revert migration 20260516010000's hardening.
--
-- Idempotency: CREATE OR REPLACE FUNCTION on a fixed signature plus
-- REVOKE/GRANT statements that are all convergent (re-running yields the same
-- ACL). No DDL on any table, no data change.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_subject_violations(
  p_plan   TEXT    DEFAULT NULL,
  p_grade  TEXT    DEFAULT NULL,
  p_stream TEXT    DEFAULT NULL,
  p_limit  INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  student_id       UUID,
  grade            TEXT,
  stream           TEXT,
  plan             TEXT,
  invalid_subjects TEXT[],
  total            INTEGER,
  total_count      BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY WITH student_ctx AS (
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
    -- Phase 3 M6: a mapped, plan-granted subject is only ALLOWED if it is
    -- still in the active catalogue. Without this join the RPC reports zero
    -- violations after an is_active-only restriction.
    JOIN subjects sub
      ON sub.code = gsm.subject_code
     AND sub.is_active
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
END;
$$;

COMMENT ON FUNCTION public.get_subject_violations(TEXT, TEXT, TEXT, INTEGER, INTEGER) IS
  'Admin forensic read model: students enrolled in subjects their grade/stream, '
  'plan, or (Phase 3 M6) the ACTIVE catalogue does not allow. Returns UUIDs and '
  'subject codes only, no PII. service_role only.';

REVOKE ALL     ON FUNCTION public.get_subject_violations(TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_subject_violations(TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_subject_violations(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;

COMMIT;
