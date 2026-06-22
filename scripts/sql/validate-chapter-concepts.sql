-- validate-chapter-concepts.sql
-- Pedagogy/quality validation for derived `chapter_concepts` lesson decks.
-- Owner: assessment. Spec: docs/superpowers/specs/2026-06-21-chapter-concepts-derivation-rubric.md
--
-- Usage: replace :grade with the grade string ("7", "9", ...). P5: grades are TEXT.
--   psql:        \set grade '7'   then run.
--   supabase cli: substitute the literal, e.g.
--     npx -y supabase db query --linked "<this query with '7' inlined>"
--
-- Returns one row per chapter with the floor check (isUsableChapterDeck) and the
-- stricter rubric check side by side. chapter_number = 0 rows are non-chapter
-- sentinels and are EXCLUDED from deck evaluation.

WITH cards AS (
  SELECT
    subject,
    chapter_number,
    concept_number,
    btrim(coalesce(title, ''))            AS title,
    btrim(coalesce(explanation, ''))      AS explanation,
    btrim(coalesce(explanation_hi, ''))   AS explanation_hi,
    btrim(coalesce(title_hi, ''))         AS title_hi,
    difficulty,
    bloom_level,
    practice_question,
    practice_options
  FROM chapter_concepts
  WHERE is_active = true
    AND grade = '7'                       -- <<< parameter: set the grade string
    AND chapter_number > 0                -- exclude sentinels
),
per_chapter AS (
  SELECT
    subject,
    chapter_number,
    count(*)                                                           AS concept_count,
    min(length(explanation))                                          AS min_expl_len,
    round(avg(length(explanation)))                                   AS avg_expl_len,
    count(*) FILTER (WHERE length(explanation) < 80)                  AS below_floor_count,
    count(*) FILTER (WHERE length(title) < 3)                         AS empty_title_count,
    count(*) - count(DISTINCT lower(title))                           AS dup_title_count,
    count(*) - count(DISTINCT lower(explanation))                     AS dup_expl_count,
    -- recycled MCQ: a practice_question reused across >1 concept in the chapter
    coalesce(sum(pq.cnt - 1) FILTER (WHERE pq.cnt > 1), 0)            AS recycled_mcq_count,
    count(DISTINCT bloom_level)                                       AS bloom_spread,
    count(DISTINCT difficulty)                                        AS diff_spread,
    count(*) FILTER (WHERE explanation_hi <> '')                      AS expl_hi_count,
    count(*) FILTER (WHERE title_hi <> '')                            AS title_hi_count
  FROM cards
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM cards c2
    WHERE c2.subject = cards.subject
      AND c2.chapter_number = cards.chapter_number
      AND c2.practice_question IS NOT NULL
      AND c2.practice_question = cards.practice_question
  ) pq ON cards.practice_question IS NOT NULL
  GROUP BY subject, chapter_number
)
SELECT
  subject,
  chapter_number,
  concept_count,
  min_expl_len,
  avg_expl_len,
  below_floor_count,
  empty_title_count,
  dup_title_count,
  dup_expl_count,
  recycled_mcq_count,
  bloom_spread,
  diff_spread,
  expl_hi_count,
  title_hi_count,
  -- FLOOR: isUsableChapterDeck (get-concepts-from-table.ts)
  (concept_count >= 3
   AND below_floor_count = 0
   AND empty_title_count = 0)                                         AS floor_pass,
  -- RUBRIC: stricter gate (section 3 + 4 of the spec). Bilingual required.
  (concept_count >= 3
   AND below_floor_count = 0
   AND empty_title_count = 0
   AND dup_title_count = 0
   AND dup_expl_count = 0
   AND recycled_mcq_count = 0
   AND avg_expl_len >= 150
   AND bloom_spread >= 2
   AND diff_spread >= 2
   AND expl_hi_count = concept_count
   AND title_hi_count = concept_count)                               AS rubric_pass
FROM per_chapter
ORDER BY subject, chapter_number;
