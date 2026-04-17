-- supabase/migrations/20260415000009_subject_governance_rpc_dedup.sql
--
-- Fix: get_available_subjects returned duplicate rows for grade 11/12 students
-- with stream=NULL (one row per stream band because of the `OR s.stream IS NULL` match).
-- Patch: aggregate grade_subject_map by subject_code with BOOL_OR(is_core) so
-- a subject that is core in ANY matching stream remains labeled core.
--
-- Discovered during production smoke-test after applying 01-04 via MCP on 2026-04-15.
-- Applied to prod via mcp apply_migration same day; this file committed for CI parity.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION get_available_subjects(p_student_id UUID)
RETURNS TABLE (
  code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
  subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  WITH s AS (SELECT grade, stream FROM students WHERE id = p_student_id),
       p AS (
         SELECT plan_code FROM student_subscriptions
          WHERE student_id = p_student_id
            AND status IN ('active','trialing','grace')
          ORDER BY current_period_end DESC NULLS LAST LIMIT 1
       ),
       effective_plan AS (
         SELECT COALESCE((SELECT plan_code FROM p), 'free') AS plan_code
       ),
       grade_valid AS (
         SELECT gsm.subject_code, BOOL_OR(gsm.is_core) AS is_core
           FROM grade_subject_map gsm, s
          WHERE gsm.grade = s.grade
            AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
          GROUP BY gsm.subject_code
       ),
       plan_valid AS (
         SELECT psa.subject_code FROM plan_subject_access psa, effective_plan ep
          WHERE psa.plan_code = ep.plan_code
       )
  SELECT sub.code, sub.name, COALESCE(sub.name_hi, sub.name), sub.icon, sub.color,
         sub.subject_kind, gv.is_core,
         (gv.subject_code NOT IN (SELECT subject_code FROM plan_valid)) AS is_locked
    FROM subjects sub
    JOIN grade_valid gv ON gv.subject_code = sub.code
   WHERE sub.is_active;
$$;

REVOKE ALL ON FUNCTION get_available_subjects(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_available_subjects(UUID) TO authenticated, service_role;

COMMIT;