-- supabase/migrations/20260415000015_validate_academic_scope.sql
-- Recovery-mode migration #3: governed academic-scope validation.
--
-- Two new RPCs:
--   validate_academic_scope(p_student_id, p_grade, p_subject, p_chapter_number)
--     → JSONB { ok, reason?, allowed_subjects?, allowed_chapters? }
--     Rules:
--       - Student must exist (resolved via id OR auth_user_id)
--       - Grade must equal student's grade
--       - Subject must be in get_available_subjects(student) AND not is_locked
--       - If chapter_number provided, must be a real chapter for (subject, grade)
--
--   available_chapters_for_student_subject(p_student_id, p_subject_code)
--     → TABLE { chapter_number, title, title_hi, total_questions, has_concepts }
--     Returns ONLY chapters that:
--       - Belong to a subject the student is allowed (grade ∩ plan ∩ stream
--         ∩ is_content_ready)
--       - Are is_active = TRUE
--     Empty result for any subject the student isn't allowed to access — no leak.
--
-- Both RPCs are SECURITY DEFINER. Designed for /api/student/chapters and
-- /api/quiz callers. Authentication is enforced by Next.js middleware/RBAC
-- before invocation; these RPCs are the second line of defence.

BEGIN;

-- ─── 1. validate_academic_scope ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_academic_scope(
  p_student_id      UUID,
  p_grade           TEXT,
  p_subject         TEXT,
  p_chapter_number  INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id    UUID;
  v_student_grade TEXT;
  v_subject_ok    BOOLEAN;
  v_chapter_ok    BOOLEAN;
BEGIN
  -- Resolve student row (accept auth_user_id OR students.id)
  SELECT id, grade INTO v_student_id, v_student_grade
    FROM students
   WHERE id = p_student_id OR auth_user_id = p_student_id
   LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'student_not_found');
  END IF;

  -- Grade match
  IF v_student_grade <> p_grade THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'grade_mismatch',
      'student_grade', v_student_grade,
      'requested_grade', p_grade
    );
  END IF;

  -- Subject must be in the student's unlocked allowlist
  SELECT EXISTS (
    SELECT 1 FROM get_available_subjects(v_student_id) gas
     WHERE gas.code = p_subject AND NOT gas.is_locked
  ) INTO v_subject_ok;

  IF NOT v_subject_ok THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'subject_not_allowed',
      'subject', p_subject
    );
  END IF;

  -- Chapter (optional) must be real for (subject, grade)
  IF p_chapter_number IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM chapters c
       WHERE c.subject_code = p_subject
         AND c.grade = p_grade
         AND c.chapter_number = p_chapter_number
         AND c.is_active
    ) INTO v_chapter_ok;

    IF NOT v_chapter_ok THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'chapter_not_in_subject',
        'subject', p_subject,
        'grade', p_grade,
        'chapter_number', p_chapter_number
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION validate_academic_scope(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_academic_scope(UUID, TEXT, TEXT, INTEGER) TO authenticated, service_role;

-- ─── 2. available_chapters_for_student_subject ────────────────────────────
CREATE OR REPLACE FUNCTION available_chapters_for_student_subject(
  p_student_id   UUID,
  p_subject_code TEXT
)
RETURNS TABLE (
  chapter_number   INTEGER,
  title            TEXT,
  title_hi         TEXT,
  ncert_page_start INTEGER,
  ncert_page_end   INTEGER,
  total_questions  INTEGER,
  has_concepts     BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
  v_allowed    BOOLEAN;
BEGIN
  SELECT id, grade INTO v_student_id, v_grade
    FROM students
   WHERE id = p_student_id OR auth_user_id = p_student_id
   LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN; -- empty result for unknown student
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM get_available_subjects(v_student_id) gas
     WHERE gas.code = p_subject_code AND NOT gas.is_locked
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RETURN; -- empty result for subjects the student cannot access
  END IF;

  RETURN QUERY
  SELECT
    c.chapter_number,
    c.title,
    c.title_hi,
    c.ncert_page_start,
    c.ncert_page_end,
    COALESCE(c.total_questions, 0)::INT AS total_questions,
    EXISTS (SELECT 1 FROM chapter_concepts cc WHERE cc.chapter_id = c.id AND cc.is_active) AS has_concepts
  FROM chapters c
  WHERE c.subject_code = p_subject_code
    AND c.grade = v_grade
    AND c.is_active
  ORDER BY c.display_order NULLS LAST, c.chapter_number;
END;
$$;

REVOKE ALL ON FUNCTION available_chapters_for_student_subject(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION available_chapters_for_student_subject(UUID, TEXT) TO authenticated, service_role;

INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'academic_scope_validation.enabled',
  'system',
  NULL,
  jsonb_build_object('enabled_at', now()),
  now()
);

COMMIT;
