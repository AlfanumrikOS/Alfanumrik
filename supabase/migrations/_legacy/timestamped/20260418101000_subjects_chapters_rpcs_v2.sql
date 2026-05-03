-- Migration: 20260418101000_subjects_chapters_rpcs_v2.sql
-- Purpose: Thin "v2" RPCs for subjects + chapters backed by cbse_syllabus
--          (the Layer-2 SSoT introduced in 20260418100000_create_cbse_syllabus).
--          Replaces the soft-fail GRADE_SUBJECTS fallback in
--          /api/student/subjects and /api/student/chapters with an explicit
--          read over the syllabus table filtered by rag_status='ready' +
--          is_in_scope=true.
--
-- Design:
--   - get_available_subjects_v2(p_student_id uuid)
--     → (subject_code, subject_display, subject_display_hi, ready_chapter_count)
--     Returns only subjects that have ≥1 chapter with rag_status='ready'
--     for the student's grade. Each row is a subject roll-up.
--
--   - available_chapters_for_student_subject_v2(p_student_id uuid, p_subject_code text)
--     → (chapter_number, chapter_title, chapter_title_hi, verified_question_count)
--     Returns only chapters with rag_status='ready' for the student's grade
--     + the passed subject_code.
--
-- Security:
--   - Both functions are SECURITY DEFINER. Rationale: the function needs to
--     JOIN students → cbse_syllabus but the anon/authenticated role doesn't
--     have RLS-level access to students (students RLS restricts rows to
--     auth.uid()). Rather than reshape students RLS, use DEFINER and do the
--     caller-identity check in the function body (p_student_id must either
--     equal students.id OR students.auth_user_id). This matches the pattern
--     used by get_available_subjects() in 20260415000013.
--   - search_path is pinned to 'public' to prevent search_path injection.
--   - EXECUTE granted to authenticated + service_role only.
--
-- Plan filtering note:
--   This v2 pair deliberately does NOT filter by plan_subject_access —
--   the spec says "pass through all ready chapters for now". Plan-based
--   gating still happens in get_available_subjects() (v1) which the foxy
--   / quiz routes use as the source of truth for plan scope. The v2 RPCs
--   return the subset "what content is physically ready to serve". A
--   follow-up migration can intersect with plan_subject_access if ops
--   decides to gate content readiness by plan.

BEGIN;

-- ─── 1. get_available_subjects_v2 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_available_subjects_v2(p_student_id UUID)
RETURNS TABLE (
  subject_code          TEXT,
  subject_display       TEXT,
  subject_display_hi    TEXT,
  ready_chapter_count   INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
BEGIN
  -- Resolve student. Accept either students.id or auth_user_id (matches
  -- existing v1 RPC behavior). Missing student → empty result, not error.
  SELECT id, grade INTO v_student_id, v_grade
    FROM students
   WHERE id = p_student_id OR auth_user_id = p_student_id
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cs.subject_code,
    -- Pick the most recently updated display string per subject — handles
    -- occasional display-string drift across chapter rows.
    (ARRAY_AGG(cs.subject_display       ORDER BY cs.updated_at DESC))[1] AS subject_display,
    (ARRAY_AGG(cs.subject_display_hi    ORDER BY cs.updated_at DESC))[1] AS subject_display_hi,
    COUNT(*)::INTEGER AS ready_chapter_count
  FROM cbse_syllabus cs
  WHERE cs.board      = 'CBSE'
    AND cs.grade      = v_grade
    AND cs.rag_status = 'ready'
    AND cs.is_in_scope = TRUE
  GROUP BY cs.subject_code
  ORDER BY cs.subject_code;
END;
$$;

REVOKE ALL ON FUNCTION get_available_subjects_v2(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_available_subjects_v2(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION get_available_subjects_v2(UUID) IS
  'Layer-2 SSoT read: returns subjects with >=1 ready chapter for the '
  'students grade. Used by /api/student/subjects after Phase 3 soft-fail '
  'removal. See docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md';

-- ─── 2. available_chapters_for_student_subject_v2 ────────────────────────
CREATE OR REPLACE FUNCTION available_chapters_for_student_subject_v2(
  p_student_id   UUID,
  p_subject_code TEXT
)
RETURNS TABLE (
  chapter_number          INTEGER,
  chapter_title           TEXT,
  chapter_title_hi        TEXT,
  verified_question_count INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
BEGIN
  IF p_subject_code IS NULL OR LENGTH(p_subject_code) = 0 THEN
    RETURN;
  END IF;

  SELECT id, grade INTO v_student_id, v_grade
    FROM students
   WHERE id = p_student_id OR auth_user_id = p_student_id
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cs.chapter_number,
    cs.chapter_title,
    cs.chapter_title_hi,
    COALESCE(cs.verified_question_count, 0)::INTEGER AS verified_question_count
  FROM cbse_syllabus cs
  WHERE cs.board         = 'CBSE'
    AND cs.grade         = v_grade
    AND cs.subject_code  = p_subject_code
    AND cs.rag_status    = 'ready'
    AND cs.is_in_scope   = TRUE
  ORDER BY cs.chapter_number;
END;
$$;

REVOKE ALL ON FUNCTION available_chapters_for_student_subject_v2(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION available_chapters_for_student_subject_v2(UUID, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION available_chapters_for_student_subject_v2(UUID, TEXT) IS
  'Layer-2 SSoT read: returns ready chapters for (student grade, subject_code). '
  'Used by /api/student/chapters after Phase 3 soft-fail removal. '
  'Returns empty set for missing student, empty/null subject, or no ready rows.';

-- ─── 3. Audit marker ──────────────────────────────────────────────────────
INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'rag_grounding.subjects_chapters_v2.created',
  'system',
  NULL,
  jsonb_build_object(
    'created_at', now(),
    'rpcs', jsonb_build_array(
      'get_available_subjects_v2',
      'available_chapters_for_student_subject_v2'
    ),
    'backed_by', 'cbse_syllabus',
    'filter', 'rag_status=ready AND is_in_scope=true'
  ),
  now()
);

COMMIT;