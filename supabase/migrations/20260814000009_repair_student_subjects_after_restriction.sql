-- Migration: 20260814000009_repair_student_subjects_after_restriction.sql
-- Phase 3 / M4 — Server-authoritative allowed-subject policy: student repair.
--
-- Purpose
--   After M1 (20260814000007) deactivates every subject outside the keep-set,
--   students can still be holding those subjects in three places. This
--   migration ships archive_inactive_subject_enrollments() — a clone of the
--   legacy archive_dead_subject_enrollments() re-keyed from
--   `is_content_ready = FALSE` to `is_active IS DISTINCT FROM TRUE`, reason
--   'subject_deactivated' — and runs it once.
--
--   Pass 1 (the legacy behaviour): students holding student_subject_enrollment
--           rows for a now-inactive subject. Archive → delete the enrollment
--           rows → resync students.selected_subjects → repoint
--           students.preferred_subject → admin_audit_log.
--
--   Pass 2 (NEW — the case the legacy function structurally cannot see):
--           students whose students.selected_subjects is populated but who
--           have NO student_subject_enrollment rows at all. The legacy
--           function's driving query starts with
--           `JOIN student_subject_enrollment`, so those students are invisible
--           to it and would keep a stale denormalised array containing
--           subjects that no longer exist anywhere in the UI. Pass 2 trims
--           selected_subjects to the active intersection.
--
--   Pass 3: students.preferred_subject → 'math' wherever it points at a
--           subject that is not active, AND wherever it still holds the
--           legacy display-name value 'Mathematics' (the baseline column
--           DEFAULT is the display string 'Mathematics', not the code 'math',
--           so untouched profiles carry a value that matches no subjects.code
--           row at all).
--
-- students.stream IS DELIBERATELY NOT TOUCHED — anywhere.
--   M2 replaced the grade 11-12 stream-scoped rows with stream-NULL rows, and
--   every resolver matches with
--     (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
--   so a stream-NULL map row matches EVERY student regardless of whether their
--   stream reads 'science', 'commerce', 'humanities' or NULL. Rewriting
--   students.stream would be a behaviour change with zero resolution benefit
--   and would destroy data the analytics/reporting surfaces still read.
--
-- teachers.subjects_taught IS DELIBERATELY NOT TRIMMED.
--   Trimming it is gated on a pending CEO decision (a teacher trimmed to zero
--   subjects has no obvious product state). A READ-ONLY diagnostic that sizes
--   that blast radius before the decision is at:
--     docs/subject-restriction-teacher-impact.sql
--   Run it against prod before proposing any teacher-side migration.
--
-- Ordering: apply AFTER 20260814000007 (M1) and 20260814000008 (M2), and
-- BEFORE 20260814000010 (M5). M5 adds an is_active write-gate to
-- enforce_subject_enrollment(); this migration only DELETEs enrollment rows
-- and never INSERTs them, so it is unaffected by that trigger either way.
--
-- Non-destructive: no DROP TABLE / DROP COLUMN. Every removed enrollment is
-- copied to legacy_subjects_archive first. No content row (question_bank,
-- cbse_syllabus, rag_content_chunks) is touched.

BEGIN;

-- ─── 1. Repair function ─────────────────────────────────────────────────────
-- SECURITY DEFINER justification (required by the architect migration rules):
--   This function repairs rows belonging to EVERY student — it writes to
--   students, student_subject_enrollment, legacy_subjects_archive and
--   admin_audit_log across the whole tenant. Running it as the invoker would
--   make it silently repair only the caller's own RLS-visible rows, which
--   would leave the majority of affected students stranded and produce a
--   falsely-clean result. EXECUTE is revoked from PUBLIC/anon/authenticated
--   and granted to service_role only (see grants below), so no student- or
--   teacher-reachable path can invoke it. search_path is pinned.
CREATE OR REPLACE FUNCTION public.archive_inactive_subject_enrollments()
RETURNS TABLE (
  student_id      UUID,
  repair_kind     TEXT,
  archived_count  INT,
  archived_codes  TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r          RECORD;
  v_dead     TEXT[];
  v_kept     TEXT[];
  v_new_pref TEXT;
BEGIN
  -- ── Pass 1: enrollment rows pointing at a subject that is not active ──
  -- LEFT JOIN (not JOIN) so an enrollment whose subject_code has no row in
  -- public.subjects at all is treated as dead rather than skipped.
  FOR r IN
    SELECT
      s.id,
      s.selected_subjects,
      s.preferred_subject,
      ARRAY_AGG(DISTINCT sse.subject_code) AS dead_codes
    FROM students s
    JOIN student_subject_enrollment sse ON sse.student_id = s.id
    LEFT JOIN subjects sub              ON sub.code       = sse.subject_code
    WHERE sub.code IS NULL
       OR sub.is_active IS DISTINCT FROM TRUE
    GROUP BY s.id, s.selected_subjects, s.preferred_subject
  LOOP
    v_dead := r.dead_codes;

    -- Keep = selected_subjects ∩ active subjects, original order preserved.
    -- Computed from the active catalogue (not merely "minus dead_codes") so a
    -- code sitting in selected_subjects without a matching enrollment row is
    -- dropped in the same pass.
    v_kept := ARRAY(
      SELECT u.c
        FROM UNNEST(COALESCE(r.selected_subjects, ARRAY[]::TEXT[]))
             WITH ORDINALITY AS u(c, ord)
       WHERE EXISTS (
         SELECT 1 FROM subjects sub WHERE sub.code = u.c AND sub.is_active
       )
       ORDER BY u.ord
    );

    -- Archive (idempotent — skip if the identical set is already archived
    -- today under the same reason).
    IF NOT EXISTS (
      SELECT 1 FROM legacy_subjects_archive lsa
       WHERE lsa.student_id       = r.id
         AND lsa.invalid_subjects = v_dead
         AND lsa.reason           = 'subject_deactivated'
         AND lsa.archived_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO legacy_subjects_archive (student_id, invalid_subjects, reason, archived_at)
      VALUES (r.id, v_dead, 'subject_deactivated', now());
    END IF;

    DELETE FROM student_subject_enrollment sse
     WHERE sse.student_id  = r.id
       AND sse.subject_code = ANY(v_dead);

    -- Preferred subject must always land on something a student can actually
    -- open: their own first surviving choice, else 'math' (present for every
    -- grade 6-12 in grade_subject_map and granted on every plan).
    v_new_pref := CASE
      WHEN r.preferred_subject IS NOT NULL
       AND EXISTS (SELECT 1 FROM subjects sub
                    WHERE sub.code = r.preferred_subject AND sub.is_active)
        THEN r.preferred_subject
      ELSE COALESCE(v_kept[1], 'math')
    END;

    UPDATE students s
       SET selected_subjects = v_kept,
           preferred_subject = v_new_pref
     WHERE s.id = r.id;

    INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
    VALUES (
      NULL,
      'subject.inactive_enrollment.archived',
      'student',
      r.id::text,
      jsonb_build_object(
        'archived',              v_dead,
        'kept',                  v_kept,
        'new_preferred_subject', v_new_pref,
        'reason',                'subject_deactivated',
        'pass',                  'enrollment',
        'archived_at',           now()
      ),
      now()
    );

    student_id     := r.id;
    repair_kind    := 'enrollment';
    archived_count := COALESCE(array_length(v_dead, 1), 0);
    archived_codes := v_dead;
    RETURN NEXT;
  END LOOP;

  -- ── Pass 2: selected_subjects populated, zero enrollment rows ──────────
  -- Invisible to pass 1 (and to the legacy archive_dead_subject_enrollments)
  -- because that driving query requires a student_subject_enrollment row.
  FOR r IN
    SELECT s.id, s.selected_subjects, s.preferred_subject
      FROM students s
     WHERE COALESCE(array_length(s.selected_subjects, 1), 0) > 0
       AND NOT EXISTS (
             SELECT 1 FROM student_subject_enrollment sse
              WHERE sse.student_id = s.id
           )
       AND EXISTS (
             SELECT 1 FROM UNNEST(s.selected_subjects) AS c
              WHERE NOT EXISTS (
                SELECT 1 FROM subjects sub
                 WHERE sub.code = c AND sub.is_active
              )
           )
  LOOP
    v_kept := ARRAY(
      SELECT u.c
        FROM UNNEST(COALESCE(r.selected_subjects, ARRAY[]::TEXT[]))
             WITH ORDINALITY AS u(c, ord)
       WHERE EXISTS (
         SELECT 1 FROM subjects sub WHERE sub.code = u.c AND sub.is_active
       )
       ORDER BY u.ord
    );

    v_dead := ARRAY(
      SELECT u.c
        FROM UNNEST(COALESCE(r.selected_subjects, ARRAY[]::TEXT[]))
             WITH ORDINALITY AS u(c, ord)
       WHERE NOT EXISTS (
         SELECT 1 FROM subjects sub WHERE sub.code = u.c AND sub.is_active
       )
       ORDER BY u.ord
    );

    IF NOT EXISTS (
      SELECT 1 FROM legacy_subjects_archive lsa
       WHERE lsa.student_id       = r.id
         AND lsa.invalid_subjects = v_dead
         AND lsa.reason           = 'subject_deactivated'
         AND lsa.archived_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO legacy_subjects_archive (student_id, invalid_subjects, reason, archived_at)
      VALUES (r.id, v_dead, 'subject_deactivated', now());
    END IF;

    v_new_pref := CASE
      WHEN r.preferred_subject IS NOT NULL
       AND EXISTS (SELECT 1 FROM subjects sub
                    WHERE sub.code = r.preferred_subject AND sub.is_active)
        THEN r.preferred_subject
      ELSE COALESCE(v_kept[1], 'math')
    END;

    UPDATE students s
       SET selected_subjects = v_kept,
           preferred_subject = v_new_pref
     WHERE s.id = r.id;

    INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
    VALUES (
      NULL,
      'subject.inactive_enrollment.archived',
      'student',
      r.id::text,
      jsonb_build_object(
        'archived',              v_dead,
        'kept',                  v_kept,
        'new_preferred_subject', v_new_pref,
        'reason',                'subject_deactivated',
        'pass',                  'selected_subjects_only',
        'archived_at',           now()
      ),
      now()
    );

    student_id     := r.id;
    repair_kind    := 'selected_subjects_only';
    archived_count := COALESCE(array_length(v_dead, 1), 0);
    archived_codes := v_dead;
    RETURN NEXT;
  END LOOP;

  -- ── Pass 3: preferred_subject normalisation ───────────────────────────
  -- Covers students that neither pass touched: preferred_subject pointing at
  -- a deactivated code, or still holding the baseline column DEFAULT
  -- 'Mathematics' (a display name, not a subjects.code value).
  -- NULL preferred_subject is left as NULL — that is a legitimate
  -- "not yet chosen" state, not a restriction casualty.
  UPDATE students s
     SET preferred_subject = 'math'
   WHERE s.preferred_subject IS NOT NULL
     AND (
       s.preferred_subject = 'Mathematics'
       OR NOT EXISTS (
         SELECT 1 FROM subjects sub
          WHERE sub.code = s.preferred_subject AND sub.is_active
       )
     );
END;
$$;

COMMENT ON FUNCTION public.archive_inactive_subject_enrollments() IS
  'Phase 3 M4 repair: archives student subject state left dangling by the '
  'math+science catalogue restriction. Keyed on subjects.is_active = FALSE, '
  'reason subject_deactivated. Idempotent — re-running after a clean run '
  'returns zero rows. service_role only.';

REVOKE ALL ON FUNCTION public.archive_inactive_subject_enrollments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_inactive_subject_enrollments() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_inactive_subject_enrollments() TO service_role;

-- ─── 2. Run once at migration time ──────────────────────────────────────────
-- Idempotent: the function's own driving queries are self-extinguishing —
-- pass 1 requires a live enrollment row on an inactive subject (deleted by
-- the first run), pass 2 requires selected_subjects to still contain an
-- inactive code (trimmed by the first run), pass 3's WHERE matches nothing
-- once every preferred_subject is an active code. A second run touches zero
-- rows and writes zero audit entries.
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.archive_inactive_subject_enrollments();
  RAISE NOTICE 'archive_inactive_subject_enrollments repaired % student(s)', v_count;
END;
$$;

COMMIT;
