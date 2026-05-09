-- ─── Phase 1 follow-up: skip duplicate-text rows in NCERT promotion ─────────
--
-- Background:
--
-- 20260513000000_promote_ncert_exercises_to_question_bank.sql intended to
-- INSERT 500 rows from `ncert_exercises` into `question_bank`. The
-- production deploy (PR #656) failed with:
--
--   ERROR: duplicate key value violates unique constraint
--   "idx_question_bank_no_duplicates" (SQLSTATE 23505)
--
-- Investigation via Supabase MCP found that question_bank has TWO unique
-- text-based indexes:
--
--   - idx_question_bank_no_duplicates ON (md5(question_text), subject, grade)
--   - idx_question_bank_unique_text   ON lower(btrim(question_text))
--
-- 6 of the 500 mappable ncert_exercises rows have question_text identical
-- (case-insensitive, trimmed) to MCQ rows already in question_bank. The
-- previous migration's WHERE NOT EXISTS only checked source_type +
-- (subject, grade, chapter, ncert_exercise) — it did not check for
-- duplicate question_text against the MCQ corpus.
--
-- This migration is the corrected version. It does not REPLACE
-- 20260513000000 (that file's transaction rolled back on prod, but may
-- have succeeded on staging — either way this follow-up is idempotent).
--
-- Two changes (both idempotent):
--
--   1. Re-apply the chk_four_options relaxation (DROP IF EXISTS + ADD).
--      Safe whether the prior migration's ALTER persisted or not.
--
--   2. INSERT the missing rows with an additional NOT EXISTS clause that
--      skips any ncert_exercise whose question_text already lives in
--      question_bank (case-insensitive, trimmed). Drops the expected
--      row count from 500 to 494.
--
-- Rationale for skipping (not merging) duplicates:
--
-- The 6 colliding rows are MCQ-shape questions in question_bank that
-- happen to share text with NCERT exercises. Merging is risky — the MCQ
-- versions have valid options + correct_answer_index, while the NCERT
-- versions have written-answer + rubric. They serve different surfaces.
-- Skipping is conservative and reversible. Phase 1.5 can address them
-- explicitly once we decide whether to convert MCQ rows or keep both.

BEGIN;

-- ─── 1. Re-apply chk_four_options relaxation (idempotent) ───────────────────

ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS chk_four_options;

ALTER TABLE public.question_bank
  ADD CONSTRAINT chk_four_options
  CHECK (question_type_v2 != 'mcq' OR jsonb_array_length(options) = 4);

COMMENT ON CONSTRAINT chk_four_options ON public.question_bank IS
  'Relaxed 2026-05-09 to MCQ-only. Non-MCQ rows carry empty options array. '
  'See migrations 20260513000000 and 20260513120000.';

-- ─── 2. Promote ncert_exercises with duplicate-text exclusion ───────────────

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
  ne.subject_code AS subject,
  ne.grade AS grade,
  ne.chapter_number AS chapter_number,

  ne.question_text AS question_text,
  NULL::text AS question_hi,

  CASE
    WHEN ne.question_type = 'mcq' THEN 'mcq'
    WHEN ne.question_type IN ('la','long','hots') OR (ne.question_type = 'numerical' AND ne.marks > 3) THEN 'long_answer'
    ELSE 'short_answer'
  END AS question_type,

  CASE
    WHEN ne.question_type = 'mcq' THEN 'mcq'
    WHEN ne.question_type IN ('la','hots') THEN 'long_answer'
    WHEN ne.question_type = 'long' AND ne.marks >= 5 THEN 'long_answer'
    WHEN ne.question_type = 'numerical' AND ne.marks > 3 THEN 'long_answer'
    ELSE 'short_answer'
  END AS question_type_v2,

  ne.question_type AS cbse_question_type,

  CASE
    WHEN ne.question_type = 'mcq' AND jsonb_typeof(ne.options) = 'array' THEN ne.options
    ELSE '[]'::jsonb
  END AS options,

  NULL::integer AS correct_answer_index,

  ne.answer_text AS expected_answer,
  NULL::text AS expected_answer_hi,
  ne.answer_text AS answer_text,
  NULL::text AS answer_text_hi,
  ne.marking_scheme AS answer_rubric,
  ne.marks AS max_marks,
  ne.marks AS marks_expected,
  ne.marks AS marks,
  ne.time_estimate_seconds AS time_estimate_seconds,

  COALESCE(
    NULLIF(ne.foxy_answer, ''),
    NULLIF(ne.solution_steps, ''),
    NULLIF(ne.answer_text, ''),
    'Refer to NCERT solution.'
  ) AS explanation,

  COALESCE(ne.difficulty, 2) AS difficulty,
  ne.bloom_level AS bloom_level,
  ne.topic_tag AS concept_tag,

  CASE
    WHEN ne.question_type = 'vsa' THEN 'A'
    WHEN ne.question_type IN ('sa','short','fill_blank') THEN 'B'
    WHEN ne.question_type IN ('la','long','hots') OR (ne.question_type = 'numerical' AND ne.marks > 3) THEN 'C'
    ELSE 'B'
  END AS paper_section,

  TRUE AS is_ncert,
  COALESCE(ne.exercise_id || '/' || ne.question_number, ne.exercise_id, ne.question_number) AS ncert_exercise,
  ne.page_number AS ncert_page,
  'ncert_extracted_2026' AS source,
  'ncert_exercise' AS source_type,

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
  AND length(ne.question_text) > 10
  AND ne.grade = ANY(ARRAY['6','7','8','9','10','11','12'])
  -- Skip rows already promoted (existing source_type='ncert_exercise' from a prior run)
  AND NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
    WHERE qb.source_type = 'ncert_exercise'
      AND qb.subject = ne.subject_code
      AND qb.grade = ne.grade
      AND qb.chapter_number = ne.chapter_number
      AND qb.ncert_exercise = COALESCE(ne.exercise_id || '/' || ne.question_number, ne.exercise_id, ne.question_number)
  )
  -- NEW: skip rows whose question_text would collide with idx_question_bank_unique_text.
  -- 6 such collisions exist as of 2026-05-09 (MCQ rows with identical text).
  AND NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
    WHERE lower(btrim(qb.question_text)) = lower(btrim(ne.question_text))
  );

-- ─── 3. Audit marker ────────────────────────────────────────────────────────

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'question_bank.ncert_exercises_promoted_v2',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'phase', 'phase_1_non_mcq_seeding_followup',
    'source_table', 'ncert_exercises',
    'target_table', 'question_bank',
    'rows_promoted_in_this_migration', (
      SELECT COUNT(*) FROM public.question_bank
      WHERE source = 'ncert_extracted_2026'
        AND created_at > now() - interval '1 minute'
    ),
    'spec', 'docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md',
    'fixes', '20260513000000 failed on idx_question_bank_no_duplicates; this migration adds NOT EXISTS on lower(btrim(question_text))',
    'reported_by', 'Pradeep Sharma',
    'reported_at', '2026-05-09'
  ),
  now();

COMMIT;
