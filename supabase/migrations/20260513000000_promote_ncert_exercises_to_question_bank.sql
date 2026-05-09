-- ─── Phase 1: Promote ncert_exercises → question_bank (final corrected) ────
--
-- Spec: docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md
--
-- This migration promotes mappable rows from `ncert_exercises` (questions
-- extracted from NCERT PDFs by extract-ncert-questions) into `question_bank`
-- so the quiz pipeline can serve them via the SA / LA / Mixed pickers.
--
-- History (combined into this single corrected file):
--
--   v1 (PR #655) failed on production: referenced `word_limit`, a column on
--                ncert_exercises but not on question_bank.
--   v2 (PR #656) fixed v1's column reference but failed on
--                idx_question_bank_no_duplicates because 6 NCERT exercises
--                share question_text with existing MCQ rows.
--   v3 (PR #658, file 20260513120000) added a NOT EXISTS filter on
--                lower(btrim(question_text)) but the deploy chain still
--                tried v1 first and aborted before reaching v3.
--   v4 (this file, applied to prod via Supabase MCP 2026-05-09) also fixes
--                a third issue: the 7 NCERT-source rows tagged
--                question_type='mcq' have NULL options, so they can't be
--                served as MCQ. They now classify as short_answer.
--
-- Schema constraints addressed:
--
--   1. chk_four_options previously required 4-option array on EVERY row.
--      Relaxed to MCQ-only: (question_type_v2 != 'mcq' OR
--      jsonb_array_length(options) = 4). Non-MCQ rows carry empty options.
--
--   2. chk_question_type_v2 allows mcq | assertion_reason | case_based |
--      short_answer | long_answer. NCERT-source rows classify by shape;
--      is_ncert=true + source_type='ncert_exercise' tag the provenance.
--
--   3. idx_question_bank_no_duplicates UNIQUE (md5(question_text), subject,
--      grade) and idx_question_bank_unique_text UNIQUE (lower(btrim(...)))
--      both block exact-text duplicates. NOT EXISTS clause skips collisions.
--
-- Idempotency:
--
--   - DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT: safe to re-run.
--   - INSERT WHERE NOT EXISTS keyed on (source_type='ncert_exercise',
--     subject, grade, chapter_number, ncert_exercise) AND on lower(btrim(
--     question_text)). Re-running is a no-op.
--
-- Production already received this content via direct MCP apply on
-- 2026-05-09 (after auto-deploy chain repeatedly aborted on v1/v2/v3).
-- When this corrected file flows through the deploy chain on the next
-- push to main, the WHERE NOT EXISTS makes it a no-op against the 494
-- rows already promoted. Audit log gets a second entry — harmless.

BEGIN;

-- ─── 1. Relax chk_four_options to MCQ-only ──────────────────────────────────

ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS chk_four_options;

ALTER TABLE public.question_bank
  ADD CONSTRAINT chk_four_options
  CHECK (question_type_v2 != 'mcq' OR jsonb_array_length(options) = 4);

COMMENT ON CONSTRAINT chk_four_options ON public.question_bank IS
  'Relaxed 2026-05-09 to MCQ-only. Non-MCQ rows carry empty options array.';

-- ─── 2. Promote ncert_exercises rows ────────────────────────────────────────

INSERT INTO public.question_bank (
  subject, grade, chapter_number,
  question_text, question_hi,
  question_type, question_type_v2,
  cbse_question_type,
  options, correct_answer_index,
  expected_answer, expected_answer_hi,
  answer_text, answer_text_hi,
  answer_rubric,
  max_marks, marks_expected, marks,
  time_estimate_seconds,
  explanation,
  difficulty, bloom_level, concept_tag,
  paper_section,
  is_ncert, ncert_exercise, ncert_page,
  source, source_type,
  verification_state, verified_against_ncert, quality_status,
  is_active,
  created_at
)
SELECT
  ne.subject_code, ne.grade, ne.chapter_number,
  ne.question_text, NULL::text,
  -- legacy question_type
  CASE
    WHEN ne.question_type = 'mcq' AND jsonb_typeof(ne.options) = 'array' AND jsonb_array_length(ne.options) = 4 THEN 'mcq'
    WHEN ne.question_type IN ('la','long','hots') OR (ne.question_type = 'numerical' AND ne.marks > 3) THEN 'long_answer'
    ELSE 'short_answer'
  END,
  -- question_type_v2: only 'mcq' if there are actually 4 options
  CASE
    WHEN ne.question_type = 'mcq' AND jsonb_typeof(ne.options) = 'array' AND jsonb_array_length(ne.options) = 4 THEN 'mcq'
    WHEN ne.question_type IN ('la','hots') THEN 'long_answer'
    WHEN ne.question_type = 'long' AND ne.marks >= 5 THEN 'long_answer'
    WHEN ne.question_type = 'numerical' AND ne.marks > 3 THEN 'long_answer'
    ELSE 'short_answer'
  END,
  ne.question_type AS cbse_question_type,
  -- options: real array only when valid MCQ, empty otherwise
  CASE
    WHEN ne.question_type = 'mcq' AND jsonb_typeof(ne.options) = 'array' AND jsonb_array_length(ne.options) = 4 THEN ne.options
    ELSE '[]'::jsonb
  END,
  NULL::integer,
  ne.answer_text, NULL::text,
  ne.answer_text, NULL::text,
  ne.marking_scheme,
  ne.marks, ne.marks, ne.marks,
  ne.time_estimate_seconds,
  COALESCE(NULLIF(ne.foxy_answer,''), NULLIF(ne.solution_steps,''), NULLIF(ne.answer_text,''), 'Refer to NCERT solution.'),
  COALESCE(ne.difficulty, 2), ne.bloom_level, ne.topic_tag,
  CASE
    WHEN ne.question_type = 'vsa' THEN 'A'
    WHEN ne.question_type IN ('sa','short','fill_blank') THEN 'B'
    WHEN ne.question_type IN ('la','long','hots') OR (ne.question_type = 'numerical' AND ne.marks > 3) THEN 'C'
    ELSE 'B'
  END,
  TRUE,
  COALESCE(ne.exercise_id || '/' || ne.question_number, ne.exercise_id, ne.question_number),
  ne.page_number,
  'ncert_extracted_2026', 'ncert_exercise',
  'verified', TRUE, 'ok',
  COALESCE(ne.is_active, TRUE),
  COALESCE(ne.created_at, now())
FROM public.ncert_exercises ne
WHERE ne.is_active = TRUE
  AND ne.subject_code IS NOT NULL
  AND ne.grade IS NOT NULL
  AND ne.chapter_number IS NOT NULL
  AND length(ne.question_text) > 10
  AND ne.grade = ANY(ARRAY['6','7','8','9','10','11','12'])
  -- Skip rows already promoted (idempotency on re-run)
  AND NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
    WHERE qb.source_type = 'ncert_exercise'
      AND qb.subject = ne.subject_code
      AND qb.grade = ne.grade
      AND qb.chapter_number = ne.chapter_number
      AND qb.ncert_exercise = COALESCE(ne.exercise_id || '/' || ne.question_number, ne.exercise_id, ne.question_number)
  )
  -- Skip text-collision with existing question_bank rows (e.g. MCQ rows
  -- that share text with NCERT exercises). Phase 1.5 will decide whether
  -- to convert those MCQ rows to written-answer or keep both surfaces.
  AND NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
    WHERE lower(btrim(qb.question_text)) = lower(btrim(ne.question_text))
  );

-- ─── 3. Audit marker ────────────────────────────────────────────────────────

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'question_bank.ncert_exercises_promoted',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'phase', 'phase_1_non_mcq_seeding',
    'source_table', 'ncert_exercises',
    'target_table', 'question_bank',
    'rows_promoted_in_this_run', (
      SELECT COUNT(*) FROM public.question_bank
      WHERE source = 'ncert_extracted_2026'
        AND created_at > now() - interval '1 minute'
    ),
    'spec', 'docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md',
    'note', 'Production initially seeded via MCP on 2026-05-09 after auto-deploy chain failures; this corrected file is a no-op against the already-promoted rows.',
    'reported_by', 'Pradeep Sharma',
    'reported_at', '2026-05-09'
  ),
  now();

COMMIT;
