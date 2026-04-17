-- supabase/migrations/20260415000017_archive_dead_subject_enrollments.sql
-- Recovery-mode migration #5: defensive repair for any students who got
-- stranded with a dead-subject selection between subject-governance ship
-- and content-readiness ship.
--
-- A "dead-subject enrollment" = student_subject_enrollment row whose
-- subject_code is now is_content_ready=false. Such a student has the
-- subject persisted in their profile but it no longer appears in
-- get_available_subjects(), so they cannot select content/quizzes for it.
--
-- Today's count (verified pre-migration): 0 students. This is preventative.
--
-- What this migration does:
--   1. Creates archive_dead_subject_enrollments() RPC — idempotent, reusable
--      from admin tooling and CI. Returns one row per student touched.
--   2. Runs it once at migration time so any future re-application of
--      content-readiness flips automatically clean up.
--   3. Adds super_admin_subject_readiness view for ops visibility.
--
-- For each affected student:
--   - Archive the dead subjects to legacy_subjects_archive with reason
--     'subject_no_content'.
--   - Remove the dead enrollments from student_subject_enrollment.
--   - Sync students.selected_subjects to drop the dead codes.
--   - If preferred_subject is dead, reset to first remaining valid subject
--     or NULL.
--   - Log to admin_audit_log.

BEGIN;

-- ─── 1. Repair function ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION archive_dead_subject_enrollments()
RETURNS TABLE (
  student_id      UUID,
  archived_count  INT,
  archived_codes  TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  r              RECORD;
  v_dead         TEXT[];
  v_kept         TEXT[];
  v_new_pref     TEXT;
BEGIN
  -- Walk every student that has at least one enrollment pointing at a
  -- subject whose is_content_ready = false.
  FOR r IN
    SELECT
      s.id,
      s.selected_subjects,
      s.preferred_subject,
      ARRAY_AGG(DISTINCT sse.subject_code) FILTER (
        WHERE sub.is_content_ready = FALSE
      ) AS dead_codes
    FROM students s
    JOIN student_subject_enrollment sse ON sse.student_id = s.id
    JOIN subjects sub                   ON sub.code        = sse.subject_code
    GROUP BY s.id, s.selected_subjects, s.preferred_subject
    HAVING ARRAY_AGG(DISTINCT sse.subject_code) FILTER (
      WHERE sub.is_content_ready = FALSE
    ) IS NOT NULL
  LOOP
    v_dead := r.dead_codes;
    v_kept := COALESCE(r.selected_subjects, ARRAY[]::TEXT[]);
    v_kept := ARRAY(
      SELECT UNNEST(v_kept)
      EXCEPT
      SELECT UNNEST(v_dead)
    );

    -- Archive (idempotent — skip if same set already archived today)
    IF NOT EXISTS (
      SELECT 1 FROM legacy_subjects_archive
       WHERE legacy_subjects_archive.student_id = r.id
         AND invalid_subjects = v_dead
         AND archived_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO legacy_subjects_archive (student_id, invalid_subjects, reason, archived_at)
      VALUES (r.id, v_dead, 'subject_no_content', now());
    END IF;

    -- Remove dead enrollment rows
    DELETE FROM student_subject_enrollment
     WHERE student_subject_enrollment.student_id = r.id
       AND subject_code = ANY(v_dead);

    -- Pick a safe preferred_subject
    v_new_pref := CASE
      WHEN r.preferred_subject = ANY(v_dead) THEN
        (SELECT v_kept[1])  -- first kept code, may be NULL
      ELSE r.preferred_subject
    END;

    -- Sync denormalized students cache
    UPDATE students
       SET selected_subjects = v_kept,
           preferred_subject = v_new_pref
     WHERE id = r.id;

    -- Audit
    INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
    VALUES (
      NULL,
      'subject.dead_enrollment.archived',
      'student',
      r.id::text,
      jsonb_build_object(
        'archived', v_dead,
        'kept',     v_kept,
        'new_preferred_subject', v_new_pref,
        'archived_at', now()
      ),
      now()
    );

    student_id     := r.id;
    archived_count := COALESCE(array_length(v_dead, 1), 0);
    archived_codes := v_dead;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION archive_dead_subject_enrollments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_dead_subject_enrollments() TO service_role;

-- ─── 2. Run once at migration time ────────────────────────────────────────
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM archive_dead_subject_enrollments();
  RAISE NOTICE 'archive_dead_subject_enrollments touched % student(s)', v_count;
END $$;

-- ─── 3. Admin readiness view ──────────────────────────────────────────────
CREATE OR REPLACE VIEW super_admin_subject_readiness AS
SELECT
  s.code                                              AS subject_code,
  s.name                                              AS subject_name,
  s.subject_kind,
  s.is_active,
  s.is_content_ready,
  (SELECT COUNT(*) FROM chapters c
     WHERE c.subject_id = s.id AND c.is_active)       AS active_chapters,
  (SELECT COUNT(*) FROM question_bank q
     WHERE q.subject = s.code)                        AS questions,
  (SELECT COUNT(*) FROM chapter_concepts cc
     WHERE cc.subject = s.code AND cc.is_active)      AS active_concepts,
  (SELECT COUNT(*) FROM rag_content_chunks rc
     WHERE rc.subject_code = s.code AND rc.is_active
       AND rc.source = 'ncert_2025')                  AS ncert_chunks,
  (SELECT ARRAY_AGG(DISTINCT plan_code ORDER BY plan_code)
     FROM plan_subject_access psa
    WHERE psa.subject_code = s.code)                  AS plans_granting_access,
  CASE
    WHEN NOT s.is_content_ready
      AND EXISTS (SELECT 1 FROM plan_subject_access psa WHERE psa.subject_code = s.code)
    THEN 'GATED — plan grants access but content missing'
    WHEN s.is_content_ready THEN 'OK'
    ELSE 'inactive'
  END                                                 AS readiness_state
FROM subjects s
WHERE s.is_active
ORDER BY s.is_content_ready, s.code;

COMMENT ON VIEW super_admin_subject_readiness IS
  'Operational view: per-subject content readiness signals (chapters, '
  'questions, concepts, NCERT chunks, plan grants). Use to triage why a '
  'subject is hidden from students.';

GRANT SELECT ON super_admin_subject_readiness TO service_role;

INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'subject.dead_enrollment_repair.enabled',
  'system',
  NULL,
  jsonb_build_object('enabled_at', now()),
  now()
);

COMMIT;
