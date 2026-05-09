-- ─── Phase 1: NCERT promotion (applied via MCP on 2026-05-09 11:34:06) ─────
--
-- Spec: docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md
--
-- This file is the local mirror of a migration that was applied directly to
-- production via Supabase MCP after the auto-deploy chain repeatedly aborted
-- on three different bugs (see commit history of #655, #656, #658, #660 for
-- detail). The schema_migrations row exists on production with name
-- 'phase1_promote_ncert_exercises_v2' and version 20260509113406. Without a
-- corresponding file in the local migrations directory, `supabase db push`
-- aborts with:
--
--   "Remote migration versions not found in local migrations directory."
--
-- This file resolves that mismatch. On production the version is already
-- recorded so the CLI skips it. On fresh environments (CI, new staging) it
-- runs as the canonical seeding step.
--
-- Schema constraints addressed:
--   1. chk_four_options relaxed to MCQ-only (DROP IF EXISTS + ADD).
--   2. NCERT-tagged 'mcq' rows with NULL options reclassify as short_answer.
--   3. NOT EXISTS on (source_type, subject, grade, chapter, ncert_exercise)
--      AND on lower(btrim(question_text)) — full duplicate-skip.

-- 1. Relax chk_four_options to MCQ-only
ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS chk_four_options;

ALTER TABLE public.question_bank
  ADD CONSTRAINT chk_four_options
  CHECK (question_type_v2 != 'mcq' OR jsonb_array_length(options) = 4);

COMMENT ON CONSTRAINT chk_four_options ON public.question_bank IS
  'Relaxed 2026-05-09 to MCQ-only. Non-MCQ rows carry empty options array.';

-- 2. Promote ncert_exercises with full duplicate exclusion + corrected MCQ classification
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
  CASE
    WHEN ne.question_type = 'mcq' AND jsonb_typeof(ne.options) = 'array' AND jsonb_array_length(ne.options) = 4 THEN 'mcq'
    WHEN ne.question_type IN ('la','long','hots') OR (ne.question_type = 'numerical' AND ne.marks > 3) THEN 'long_answer'
    ELSE 'short_answer'
  END,
  CASE
    WHEN ne.question_type = 'mcq' AND jsonb_typeof(ne.options) = 'array' AND jsonb_array_length(ne.options) = 4 THEN 'mcq'
    WHEN ne.question_type IN ('la','hots') THEN 'long_answer'
    WHEN ne.question_type = 'long' AND ne.marks >= 5 THEN 'long_answer'
    WHEN ne.question_type = 'numerical' AND ne.marks > 3 THEN 'long_answer'
    ELSE 'short_answer'
  END,
  ne.question_type,
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
  AND NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
    WHERE qb.source_type = 'ncert_exercise'
      AND qb.subject = ne.subject_code
      AND qb.grade = ne.grade
      AND qb.chapter_number = ne.chapter_number
      AND qb.ncert_exercise = COALESCE(ne.exercise_id || '/' || ne.question_number, ne.exercise_id, ne.question_number)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.question_bank qb
    WHERE lower(btrim(qb.question_text)) = lower(btrim(ne.question_text))
  );

-- 3. Audit marker
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'question_bank.ncert_exercises_promoted_via_mcp',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'phase', 'phase_1_non_mcq_seeding',
    'applied_via', 'mcp_apply_migration',
    'rows_promoted_in_this_run', (
      SELECT COUNT(*) FROM public.question_bank
      WHERE source = 'ncert_extracted_2026'
        AND created_at > now() - interval '1 minute'
    ),
    'spec', 'docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md',
    'reported_by', 'Pradeep Sharma',
    'reported_at', '2026-05-09'
  ),
  now();
