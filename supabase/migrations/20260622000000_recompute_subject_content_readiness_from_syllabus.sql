-- Migration: 20260622000000_recompute_subject_content_readiness_from_syllabus.sql
-- Purpose: Recompute subjects.is_content_ready from the SAME content sources the
--          student picker actually serves (rag-ready cbse_syllabus chapters +
--          active question_bank rows), so subjects with real content are no
--          longer flagged "not ready" just because the legacy `chapters`
--          catalog table happens to be empty for them.
--
-- Root cause this fixes:
--   The existing compute_subject_content_readiness() derives the boolean from
--   COUNT(chapters WHERE subject_id = ... AND is_active). For 11 subjects
--   (accountancy, business_studies, economics, fine_arts, geography,
--   health_fitness, history_sr, home_science, political_science, psychology,
--   sociology) the `chapters` catalog has ZERO rows, even though cbse_syllabus
--   has rag-ready chapters AND question_bank has hundreds of questions for each.
--   Those subjects were therefore stuck at is_content_ready = FALSE.
--
--   The student subject picker (get_available_subjects / _v2) and the chapter
--   list (available_chapters_for_student_subject_v2) read cbse_syllabus, NOT the
--   `chapters` catalog, and do NOT gate on is_content_ready — so the picker is
--   already functional. But the stale boolean is a latent regression risk (any
--   future re-introduction of the gate would silently hide these subjects) and
--   drives readiness badges/summaries. This migration aligns the boolean with
--   the real content the platform serves.
--
-- Safety:
--   * Idempotent: CREATE OR REPLACE + a deterministic recompute UPDATE. Re-runs
--     converge to the same state. No DROP, no schema change, additive only.
--   * P5: grade is compared as TEXT throughout ('6'..'12'); no integer grades.
--   * RLS-safe: SECURITY DEFINER, owner-executed; no client path is altered.
--   * No new tables (no RLS policies required).

BEGIN;

-- ─── New readiness computer keyed on the served content sources ──────────────
-- A subject is "content ready" when, for ANY in-scope grade mapped to it, there
-- is at least one rag-ready (partial|ready) in-scope cbse_syllabus chapter AND
-- at least one active question in question_bank. This mirrors exactly what the
-- picker + chapter-list RPCs surface to students.
CREATE OR REPLACE FUNCTION public.compute_subject_content_readiness_v2()
RETURNS TABLE(
  subject_code   TEXT,
  was            BOOLEAN,
  now_state      BOOLEAN,
  ready_chapters INTEGER,
  questions      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_was        BOOLEAN;
  v_now        BOOLEAN;
  v_ready_chaps INT;
  v_questions  INT;
BEGIN
  FOR r IN SELECT s.code, s.id, s.is_content_ready FROM subjects s WHERE s.is_active LOOP
    v_was := r.is_content_ready;

    -- Rag-ready, in-scope chapters from the syllabus the picker reads.
    SELECT COUNT(DISTINCT (cs.grade, cs.chapter_number))
      INTO v_ready_chaps
      FROM cbse_syllabus cs
     WHERE cs.subject_code = r.code
       AND cs.rag_status   IN ('partial', 'ready')
       AND cs.is_in_scope  = TRUE
       AND cs.grade ~ '^(6|7|8|9|10|11|12)$';   -- P5: grade is TEXT

    -- Active questions for the same subject (any served grade).
    SELECT COUNT(*)
      INTO v_questions
      FROM question_bank q
     WHERE q.subject = r.code
       AND q.is_active = TRUE;

    v_now := (v_ready_chaps > 0 AND v_questions > 0);

    IF v_was IS DISTINCT FROM v_now THEN
      UPDATE subjects SET is_content_ready = v_now WHERE id = r.id;
    END IF;

    subject_code   := r.code;
    was            := v_was;
    now_state      := v_now;
    ready_chapters := v_ready_chaps;
    questions      := v_questions;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_subject_content_readiness_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_subject_content_readiness_v2() TO service_role;

-- ─── Recompute now so the corrected boolean is live without waiting on cron ──
DO $$
BEGIN
  PERFORM public.compute_subject_content_readiness_v2();
END;
$$;

COMMIT;
