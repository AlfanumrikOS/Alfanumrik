-- supabase/migrations/20260415000005_subject_violations_detect.sql
-- Phase F1 — Subject Governance: detect legacy subject violations
--
-- What it does:
--   Walks every student with non-empty selected_subjects, computes the set of
--   subjects that are NOT in get_available_subjects() (non-locked), and writes
--   one row per offending student to admin_audit_log for ops visibility.
--   Also emits one summary row to ops_events.
--
-- Idempotency:
--   Safe to re-run. At the start, it deletes same-day detection rows authored
--   by this migration's action code so the daily snapshot is always fresh.
--   Historical detections (prior days) are preserved.
--
-- Expected runtime on a 10K-student DB:
--   ~30 seconds (one RPC + one array diff per student, no writes to students).
--
-- Rollback:
--   DELETE FROM admin_audit_log WHERE action = 'subject.legacy_violation.detected';
--   DELETE FROM ops_events       WHERE source = 'subject-governance-detect';
--   This migration does not modify any user data, so rollback is pure cleanup.

BEGIN;

-- Idempotency: clear prior detection rows from today's run only.
-- (Historical detections are intentionally preserved for trending.)
DELETE FROM admin_audit_log
WHERE action = 'subject.legacy_violation.detected'
  AND created_at::date = CURRENT_DATE;

DO $$
DECLARE
  r       RECORD;
  invalid TEXT[];
  allowed TEXT[];
BEGIN
  FOR r IN SELECT id, selected_subjects FROM students
            WHERE selected_subjects IS NOT NULL
              AND array_length(selected_subjects, 1) > 0
  LOOP
    SELECT ARRAY_AGG(code) INTO allowed
      FROM get_available_subjects(r.id)
     WHERE NOT is_locked;

    SELECT ARRAY(
      SELECT UNNEST(r.selected_subjects)
      EXCEPT
      SELECT UNNEST(COALESCE(allowed, ARRAY[]::TEXT[]))
    ) INTO invalid;

    IF array_length(invalid, 1) > 0 THEN
      INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
      VALUES (
        NULL,
        'subject.legacy_violation.detected',
        'student',
        r.id::text,
        jsonb_build_object(
          'invalid',     invalid,
          'allowed',     COALESCE(allowed, ARRAY[]::TEXT[]),
          'detected_at', now()
        ),
        now()
      );
    END IF;
  END LOOP;
END $$;

-- Surface a count to ops_events for monitoring (guarded in case ops_events
-- is not yet present in some environments).
INSERT INTO ops_events (
  occurred_at, category, source, severity,
  subject_type, subject_id, message, context, environment
)
SELECT
  now(),
  'data-integrity',
  'subject-governance-detect',
  'info',
  'system',
  NULL,
  'subject.governance.detect_complete',
  jsonb_build_object(
    'violation_count',
    (SELECT COUNT(*) FROM admin_audit_log
      WHERE action = 'subject.legacy_violation.detected'
        AND created_at::date = CURRENT_DATE),
    'detected_at', now()
  ),
  COALESCE(current_setting('app.environment', true), 'production')
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'ops_events'
);

COMMIT;
