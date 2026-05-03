-- supabase/migrations/20260415000006_subject_violations_repair.sql
-- Phase F2 — Subject Governance: repair legacy subject violations
--
-- What it does:
--   For each student with selected_subjects, splits the array into `valid`
--   (present in get_available_subjects non-locked) and `invalid`. Then:
--     1. Archives `invalid` into legacy_subjects_archive (if not already
--        archived today for the same invalid set).
--     2. Replaces rows in student_subject_enrollment with `valid` only
--        (DELETE+INSERT is safe because Phase F3 has not yet enabled the
--        enforcement trigger, and ON CONFLICT DO NOTHING makes INSERT
--        idempotent on re-run).
--     3. Syncs the denormalized students.selected_subjects to `valid` and
--        points preferred_subject at a valid entry (or NULL if none).
--     4. Writes one 'subject.legacy_violation.repaired' row per student to
--        admin_audit_log.
--   Emits a summary row to ops_events.
--
-- Idempotency:
--   Re-running is safe. Same-day duplicate archives are skipped via a
--   (student_id, invalid_subjects, archived_at::date) check. Enrollment is
--   reset to `valid` every run. Audit rows accumulate (one per run) — use
--   created_at::date = CURRENT_DATE to find "today's repair".
--   IMPORTANT: This migration MUST run BEFORE 20260415000007 (which enables
--   the enrollment trigger). If the trigger were active, DELETE+INSERT could
--   be blocked by plan/grade checks for students mid-migration.
--
-- Expected runtime on a 10K-student DB:
--   ~60 seconds. Dominated by per-student RPC + writes to 3 tables.
--
-- Rollback:
--   Partial rollback is tricky because we overwrite selected_subjects and
--   preferred_subject. The original invalid subjects are preserved in
--   legacy_subjects_archive; restore with:
--     UPDATE students s
--        SET selected_subjects = array_cat(s.selected_subjects, a.invalid_subjects)
--       FROM legacy_subjects_archive a
--      WHERE a.student_id = s.id
--        AND a.archived_at::date = CURRENT_DATE;
--     DELETE FROM student_subject_enrollment
--      WHERE source = 'migration' AND selected_at::date = CURRENT_DATE;
--     DELETE FROM admin_audit_log
--      WHERE action = 'subject.legacy_violation.repaired'
--        AND created_at::date = CURRENT_DATE;

BEGIN;

DO $$
DECLARE
  r       RECORD;
  valid   TEXT[];
  invalid TEXT[];
  allowed TEXT[];
BEGIN
  FOR r IN SELECT id, selected_subjects, preferred_subject FROM students
            WHERE selected_subjects IS NOT NULL
              AND array_length(selected_subjects, 1) > 0
  LOOP
    SELECT ARRAY_AGG(code) INTO allowed
      FROM get_available_subjects(r.id)
     WHERE NOT is_locked;

    valid := ARRAY(
      SELECT UNNEST(r.selected_subjects)
      INTERSECT
      SELECT UNNEST(COALESCE(allowed, ARRAY[]::TEXT[]))
    );
    invalid := ARRAY(
      SELECT UNNEST(r.selected_subjects)
      EXCEPT
      SELECT UNNEST(COALESCE(allowed, ARRAY[]::TEXT[]))
    );

    -- Idempotency: don't double-archive on re-run within the same day
    -- when the invalid set is identical.
    IF array_length(invalid, 1) > 0 AND NOT EXISTS (
      SELECT 1 FROM legacy_subjects_archive
       WHERE student_id = r.id
         AND invalid_subjects = invalid
         AND archived_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO legacy_subjects_archive (student_id, invalid_subjects, reason, archived_at)
      VALUES (r.id, invalid, 'grade_plan_mismatch', now());
    END IF;

    -- Reset enrollment to `valid` only. DELETE+INSERT is safe here because
    -- the enforcement trigger is still DISABLED (enabled in F3).
    DELETE FROM student_subject_enrollment WHERE student_id = r.id;
    IF array_length(valid, 1) > 0 THEN
      INSERT INTO student_subject_enrollment (student_id, subject_code, source)
        SELECT r.id, UNNEST(valid), 'migration'
        ON CONFLICT (student_id, subject_code) DO NOTHING;
    END IF;

    -- Sync denormalized cache on students row.
    UPDATE students
       SET selected_subjects = COALESCE(valid, ARRAY[]::TEXT[]),
           preferred_subject = CASE
             WHEN r.preferred_subject = ANY(valid) THEN r.preferred_subject
             WHEN array_length(valid, 1) > 0       THEN valid[1]
             ELSE NULL
           END
     WHERE id = r.id;

    INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
    VALUES (
      NULL,
      'subject.legacy_violation.repaired',
      'student',
      r.id::text,
      jsonb_build_object(
        'kept',        COALESCE(valid, ARRAY[]::TEXT[]),
        'archived',    COALESCE(invalid, ARRAY[]::TEXT[]),
        'repaired_at', now()
      ),
      now()
    );
  END LOOP;
END $$;

INSERT INTO ops_events (
  occurred_at, category, source, severity,
  subject_type, subject_id, message, context, environment
)
SELECT
  now(),
  'data-integrity',
  'subject-governance-repair',
  'info',
  'system',
  NULL,
  'subject.governance.repair_complete',
  jsonb_build_object(
    'archived_count',
    (SELECT COUNT(*) FROM legacy_subjects_archive
      WHERE archived_at::date = CURRENT_DATE),
    'repaired_count',
    (SELECT COUNT(*) FROM admin_audit_log
      WHERE action = 'subject.legacy_violation.repaired'
        AND created_at::date = CURRENT_DATE),
    'completed_at', now()
  ),
  COALESCE(current_setting('app.environment', true), 'production')
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'ops_events'
);

COMMIT;
