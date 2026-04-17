-- supabase/migrations/20260415000013_subject_content_readiness.sql
-- Recovery-mode migration #1: gate subjects on actual downstream content.
--
-- Problem: plan_subject_access grants paying tiers access to subjects
-- (accountancy, business_studies, coding, economics, geography, history_sr,
--  political_science) that have ZERO rows in chapters/chapter_concepts/
-- question_bank. Class 11 commerce/humanities students see the subject in
-- their picker but the chapter list is empty, the quiz returns no questions,
-- and the Learn page is blank. This migration:
--   1. Adds subjects.is_content_ready BOOLEAN (default FALSE).
--   2. Adds compute_subject_content_readiness() to recompute the flag from
--      live chapters + question_bank counts. Run from CI / admin tooling.
--   3. Backfills the flag from current production data.
--   4. Updates get_available_subjects() to filter on is_content_ready.
--   5. Updates get_subject_violations() awareness via comment.
--
-- Safe / idempotent. No DROP. No data loss.
--
-- Rollback:
--   -- Recreate the pre-this-migration get_available_subjects (see git history).
--   -- ALTER TABLE subjects DROP COLUMN is_content_ready;

BEGIN;

-- ─── 1. Schema ────────────────────────────────────────────────────────────
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS is_content_ready BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN subjects.is_content_ready IS
  'TRUE when this subject has at least 1 row in chapters AND at least 1 row '
  'in question_bank. Computed by compute_subject_content_readiness(). '
  'Filtered by get_available_subjects() so plan-allowed-but-content-empty '
  'subjects are NOT shown to students. Admin must seed content first.';

-- ─── 2. Compute function ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_subject_content_readiness()
RETURNS TABLE (subject_code TEXT, was BOOLEAN, now BOOLEAN, chapters INT, questions INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  r RECORD;
  v_was BOOLEAN;
  v_now BOOLEAN;
  v_chapters INT;
  v_questions INT;
BEGIN
  FOR r IN SELECT s.code, s.id, s.is_content_ready FROM subjects s WHERE s.is_active LOOP
    v_was := r.is_content_ready;
    SELECT COUNT(*) INTO v_chapters   FROM chapters c     WHERE c.subject_id = r.id AND c.is_active;
    SELECT COUNT(*) INTO v_questions  FROM question_bank q WHERE q.subject = r.code;
    v_now := (v_chapters > 0 AND v_questions > 0);
    IF v_was IS DISTINCT FROM v_now THEN
      UPDATE subjects SET is_content_ready = v_now WHERE id = r.id;
    END IF;
    subject_code := r.code; was := v_was; now := v_now;
    chapters := v_chapters; questions := v_questions;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION compute_subject_content_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_subject_content_readiness() TO service_role;

-- ─── 3. Backfill from current data ────────────────────────────────────────
SELECT * FROM compute_subject_content_readiness();

-- ─── 4. Update get_available_subjects to filter on is_content_ready ───────
CREATE OR REPLACE FUNCTION get_available_subjects(p_student_id UUID)
RETURNS TABLE (
  code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
  subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  WITH s AS (
    SELECT id, grade, stream FROM students
     WHERE id = p_student_id OR auth_user_id = p_student_id
     LIMIT 1
  ),
  p AS (
    SELECT plan_code FROM student_subscriptions
     WHERE student_id = (SELECT id FROM s)
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
   WHERE sub.is_active
     AND sub.is_content_ready;       -- ★ NEW: hide subjects with no content
$$;

REVOKE ALL ON FUNCTION get_available_subjects(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_available_subjects(UUID) TO authenticated, service_role;

-- ─── 5. Audit log entry for the cutover ───────────────────────────────────
INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'subject.content_readiness.enabled',
  'system',
  NULL,
  jsonb_build_object(
    'enabled_at', now(),
    'note', 'get_available_subjects now filters on is_content_ready. Subjects without chapters+questions are hidden from students.'
  ),
  now()
);

COMMIT;
