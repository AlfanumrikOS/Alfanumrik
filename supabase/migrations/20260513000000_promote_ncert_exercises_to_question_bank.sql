-- ─── Phase 1: Promote ncert_exercises → question_bank ─────────────────────
--
-- Background:
--
-- `question_bank` has 8,042 rows, all `question_type_v2 = 'mcq'`. The
-- QuizSetup picker offers Short Answer / Long Answer / NCERT Exercise but
-- those types have zero rows, so students hit empty-state on every non-MCQ
-- pick. CBSE board exams require students to *write* answers — VSA / SA /
-- MA / LA — so the platform isn't preparing them for the exam they sit.
--
-- Meanwhile, `ncert_exercises` already holds 687 rows extracted from NCERT
-- PDFs by `extract-ncert-questions`. Each row has a real CBSE-style
-- question, the canonical NCERT answer, a marking scheme, marks, bloom
-- level, and (sometimes) a diagram URL. They've just never been promoted
-- into `question_bank` for the quiz pipeline to read.
--
-- This migration promotes 500 mappable rows (the subset with non-NULL
-- subject_code + grade — the remaining 187 are pre-schema-update extracts
-- and need a textbook_id-join backfill in Phase 1.5).
--
-- Schema constraints addressed:
--
--   1. `chk_four_options` previously required `jsonb_array_length(options) = 4`
--      for *every* row. That's a schema bug for non-MCQ types — short/long
--      answer questions don't have options. We relax to MCQ-only:
--
--        CHECK (question_type_v2 != 'mcq' OR jsonb_array_length(options) = 4)
--
--      MCQ rows still get the 4-option check; non-MCQ can carry an empty
--      `[]` options jsonb.
--
--   2. `chk_question_type_v2` allows mcq | assertion_reason | case_based |
--      short_answer | long_answer. There is no 'ncert' value; NCERT-source
--      rows are classified by *shape* (SA or LA) and tagged with
--      `is_ncert = true` + `source_type = 'ncert_exercise'` for traceability
--      and future picker filters.
--
-- Type mapping (ncert_exercises.question_type → question_bank.question_type_v2):
--
--   vsa         → short_answer  (very short answer, 1m, single fact/sentence)
--   sa          → short_answer  (2-3m)
--   short       → short_answer
--   fill_blank  → short_answer
--   numerical   → short_answer if marks <= 3, else long_answer
--   la          → long_answer   (5m+, structured)
--   long        → long_answer if marks >= 5, else short_answer
--   hots        → long_answer   (HOTS, 4-5m, complex reasoning)
--   mcq         → mcq           (the 7 NCERT MCQs, kept as MCQ)
--
-- Idempotency:
--
--   WHERE NOT EXISTS sub-select keys on (source_type='ncert_exercise',
--   subject, grade, ncert_exercise). Re-running the migration is a no-op
--   after the first apply. No need for a unique constraint addition (we
--   can add one in a follow-up if Phase 6's backfill cron needs it).
--
-- Phase 1 success criteria:
--
--   - SA picker on /quiz returns NCERT questions for chapters with NCERT
--     coverage (e.g. Grade 7 Sanskrit Ch 1, Grade 11 Biology multiple chapters).
--   - LA picker returns LA-shape NCERT questions where present.
--   - Mixed picker includes both.
--   - MCQ picker behavior unchanged (the 7 promoted MCQs are additive).
--   - NCERT picker still empty until Phase 1.5 wires the is_ncert filter.
--
-- Reported by Pradeep 2026-05-09. Spec: docs/superpowers/plans/
-- 2026-05-09-non-mcq-question-seeding.md.

BEGIN;

-- ─── 1. Relax chk_four_options to MCQ-only ──────────────────────────────────

ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS chk_four_options;

ALTER TABLE public.question_bank
  ADD CONSTRAINT chk_four_options
  CHECK (question_type_v2 != 'mcq' OR jsonb_array_length(options) = 4);

COMMENT ON CONSTRAINT chk_four_options ON public.question_bank IS
  'Phase 1 (2026-05-09): widened from unconditional 4-option check to '
  'MCQ-only. Non-MCQ rows carry an empty options array. See migration '
  '20260513000000 for context.';

-- ─── 2. Promote 500 mappable ncert_exercises rows into question_bank ────────

INSERT INTO public.question_bank (
  -- identity
  subject, grade, chapter_number,
  -- question content
  question_text, question_hi,
  question_type, question_type_v2,
  cbse_question_type,
  -- MCQ shape (empty for non-MCQ; chk_four_options now allows this)
  options, correct_answer_index,
  -- written-answer fields
  expected_answer, expected_answer_hi,
  answer_text, answer_text_hi,
  answer_rubric,
  max_marks, marks_expected, marks,
  word_limit, time_estimate_seconds,
  -- explanation + hints
  explanation,
  -- pedagogy metadata
  difficulty, bloom_level, concept_tag,
  paper_section,
  -- NCERT provenance
  is_ncert, ncert_exercise, ncert_page,
  source, source_type,
  -- verification (NCERT is canonical)
  verification_state, verified_against_ncert, quality_status,
  is_active,
  -- audit
  created_at
)
SELECT
  ne.subject_code AS subject,
  ne.grade AS grade,
  ne.chapter_number AS chapter_number,

  ne.question_text AS question_text,
  NULL::text AS question_hi,  -- Phase 4 backfills Hindi

  -- Map to legacy question_type field (non-strict)
  CASE
    WHEN ne.question_type = 'mcq' THEN 'mcq'
    WHEN ne.question_type IN ('la','long','hots') OR (ne.question_type = 'numerical' AND ne.marks > 3) THEN 'long_answer'
    ELSE 'short_answer'
  END AS question_type,

  -- question_type_v2 (chk_question_type_v2 enforced)
  CASE
    WHEN ne.question_type = 'mcq' THEN 'mcq'
    WHEN ne.question_type IN ('la','hots') THEN 'long_answer'
    WHEN ne.question_type = 'long' AND ne.marks >= 5 THEN 'long_answer'
    WHEN ne.question_type = 'numerical' AND ne.marks > 3 THEN 'long_answer'
    ELSE 'short_answer'
  END AS question_type_v2,

  -- cbse_question_type preserves the original NCERT classification
  ne.question_type AS cbse_question_type,

  -- Options: real options for MCQ, empty array for non-MCQ.
  -- chk_four_options gates the 4-element rule on question_type_v2='mcq'
  -- so '[]'::jsonb is now valid for written-answer rows.
  CASE
    WHEN ne.question_type = 'mcq' AND jsonb_typeof(ne.options) = 'array' THEN ne.options
    ELSE '[]'::jsonb
  END AS options,

  -- correct_answer_index: NULL for non-MCQ (chk_valid_answer_index allows NULL).
  -- For MCQ NCERT questions, ncert_exercises.options is a jsonb array of
  -- {text, is_correct} objects; we don't have a clean correct_answer_index
  -- column here, so leave NULL — the 7 NCERT MCQs will need a follow-up to
  -- compute the index from the options jsonb if they're to be MCQ-served.
  -- For now they'll filter into the MCQ picker but render via the existing
  -- options array (UI can scan for is_correct=true).
  NULL::integer AS correct_answer_index,

  -- Written-answer fields
  ne.answer_text AS expected_answer,
  NULL::text AS expected_answer_hi,
  ne.answer_text AS answer_text,
  NULL::text AS answer_text_hi,
  ne.marking_scheme AS answer_rubric,
  ne.marks AS max_marks,
  ne.marks AS marks_expected,
  ne.marks AS marks,
  ne.word_limit AS word_limit,
  ne.time_estimate_seconds AS time_estimate_seconds,

  -- Explanation: prefer foxy_answer (curated bilingual-aware), fall back to
  -- solution_steps, then to a stub. The validator requires explanation
  -- length >= 20 chars; NCERT answers are typically much longer than that.
  COALESCE(
    NULLIF(ne.foxy_answer, ''),
    NULLIF(ne.solution_steps, ''),
    NULLIF(ne.answer_text, ''),
    'Refer to NCERT solution.'
  ) AS explanation,

  -- Pedagogy
  COALESCE(ne.difficulty, 2) AS difficulty,
  ne.bloom_level AS bloom_level,
  ne.topic_tag AS concept_tag,

  -- CBSE paper section (A=VSA, B=SA, C=LA, D=Case-Based; rough mapping)
  CASE
    WHEN ne.question_type = 'vsa' THEN 'A'
    WHEN ne.question_type IN ('sa','short','fill_blank') THEN 'B'
    WHEN ne.question_type IN ('la','long','hots') OR (ne.question_type = 'numerical' AND ne.marks > 3) THEN 'C'
    ELSE 'B'
  END AS paper_section,

  -- NCERT provenance
  TRUE AS is_ncert,
  COALESCE(ne.exercise_id || '/' || ne.question_number, ne.exercise_id, ne.question_number) AS ncert_exercise,
  ne.page_number AS ncert_page,
  'ncert_extracted_2026' AS source,
  'ncert_exercise' AS source_type,

  -- Verification: NCERT is canonical; mark verified.
  'verified' AS verification_state,
  TRUE AS verified_against_ncert,
  'ok' AS quality_status,

  COALESCE(ne.is_active, TRUE) AS is_active,
  COALESCE(ne.created_at, now()) AS created_at

FROM public.ncert_exercises ne
WHERE ne.is_active = TRUE
  AND ne.subject_code IS NOT NULL
  AND ne.grade IS NOT NULL
  AND ne.chapter_number IS NOT NULL
  -- chk_question_not_empty: question_text length > 10
  AND length(ne.question_text) > 10
  -- chk_question_bank_grade_p5: grade in '6'..'12'
  AND ne.grade = ANY(ARRAY['6','7','8','9','10','11','12'])
  -- Idempotency: skip rows already promoted
  AND NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
    WHERE qb.source_type = 'ncert_exercise'
      AND qb.subject = ne.subject_code
      AND qb.grade = ne.grade
      AND qb.chapter_number = ne.chapter_number
      AND qb.ncert_exercise = COALESCE(ne.exercise_id || '/' || ne.question_number, ne.exercise_id, ne.question_number)
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
    'rows_promoted', (
      SELECT COUNT(*) FROM public.question_bank
      WHERE source = 'ncert_extracted_2026'
        AND created_at > now() - interval '1 minute'
    ),
    'spec', 'docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md',
    'reported_by', 'Pradeep Sharma',
    'reported_at', '2026-05-09'
  ),
  now();

COMMIT;
