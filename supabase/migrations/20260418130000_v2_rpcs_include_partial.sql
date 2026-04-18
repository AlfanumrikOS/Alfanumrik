-- Migration: 20260418130000_v2_rpcs_include_partial.sql
-- Purpose : Hotfix for study-path breakage during Phase 4 drain window.
--
-- Context:
--   20260418101000 defined get_available_subjects_v2 and
--   available_chapters_for_student_subject_v2 to filter rag_status = 'ready'.
--   A chapter reaches 'ready' only when chunk_count >= 50 AND
--   verified_question_count >= 40. Immediately post-deploy (before the
--   verify-question-bank cron has drained the legacy_unverified backlog),
--   almost no chapter is 'ready', so the student-facing subject + chapter
--   pickers returned empty lists.
--
-- Fix:
--   Widen both RPCs to include rag_status IN ('partial', 'ready'). A
--   'partial' chapter has at least one chunk (chunk_count > 0) but has
--   not yet hit the verified-question threshold. That's enough content
--   for students to pick into — AI surfaces below (grounded-answer
--   service + quiz serve path) still enforce their own stricter gates:
--
--     - grounded-answer coverage precheck: unchanged; still short-circuits
--       with abstain_reason='chapter_not_ready' for non-ready chapters.
--       Foxy will soft-abstain with the "Unverified" banner; quiz will
--       hard-abstain. That's the correct behavior per spec §9.
--
--     - Quiz serve path (select_quiz_questions_rag): unchanged; still
--       gates on verified_against_ncert=true per the ff_grounded_ai_
--       enforced_pairs flag. Partial chapters with zero verified
--       questions will 422 with insufficient_questions_in_scope —
--       existing UX handles this.
--
--   Post-drain (Phase 4 Day 10+, once most chapters are 'ready'), an
--   optional follow-up migration can tighten back to ready-only. Not
--   required — the current architecture self-gates at the AI/quiz layer.
--
-- Column contracts unchanged:
--   get_available_subjects_v2.ready_chapter_count now counts any
--   picker-visible chapter (partial + ready), not strictly 'ready'.
--   Client UI uses this as "number of chapters you can start with"
--   which matches the widened semantics.

BEGIN;

-- ─── 1. get_available_subjects_v2 (widened filter) ───────────────────────
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
    (ARRAY_AGG(cs.subject_display       ORDER BY cs.updated_at DESC))[1] AS subject_display,
    (ARRAY_AGG(cs.subject_display_hi    ORDER BY cs.updated_at DESC))[1] AS subject_display_hi,
    COUNT(*)::INTEGER AS ready_chapter_count
  FROM cbse_syllabus cs
  WHERE cs.board       = 'CBSE'
    AND cs.grade       = v_grade
    AND cs.rag_status  IN ('partial', 'ready')   -- widened from ='ready'
    AND cs.is_in_scope = TRUE
  GROUP BY cs.subject_code
  ORDER BY cs.subject_code;
END;
$$;

COMMENT ON FUNCTION get_available_subjects_v2(UUID) IS
  'Layer-2 SSoT read (widened 2026-04-18): returns subjects with >=1 '
  'chapter in (partial, ready) state for the students grade. Widened from '
  'ready-only to keep the study path functional during the verify-question-'
  'bank drain window. AI surfaces below enforce their own stricter gates.';

-- ─── 2. available_chapters_for_student_subject_v2 (widened filter) ──────
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
    AND cs.rag_status    IN ('partial', 'ready')    -- widened from ='ready'
    AND cs.is_in_scope   = TRUE
  ORDER BY cs.chapter_number;
END;
$$;

COMMENT ON FUNCTION available_chapters_for_student_subject_v2(UUID, TEXT) IS
  'Layer-2 SSoT read (widened 2026-04-18): returns partial+ready chapters. '
  'Quiz-serve path + grounded-answer coverage precheck still enforce '
  'stricter gates. See 20260418130000_v2_rpcs_include_partial.sql.';

-- ─── 3. Audit marker ─────────────────────────────────────────────────────
INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'rag_grounding.v2_rpcs_widened',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'rpcs', jsonb_build_array(
      'get_available_subjects_v2',
      'available_chapters_for_student_subject_v2'
    ),
    'old_filter', 'rag_status=ready',
    'new_filter', 'rag_status IN (partial, ready)',
    'reason', 'drain_window_empty_picker_hotfix',
    'reverts_on', 'Phase 4 Day 10+ once most chapters are ready (optional)'
  ),
  now()
);

COMMIT;
