-- supabase/migrations/20260415000014_chapters_canonical_master.sql
-- Recovery-mode migration #2: make `chapters` the single canonical chapter master.
--
-- Pre-state (verified live, 2026-04-15):
--   chapters:                542 rows, indexed by (subject_id, grade, chapter_number)
--   chapter_concepts:        339 rows, keyed by (grade, subject TEXT, chapter_number) — NO FK
--     of which 10 have no matching `chapters` row
--   question_bank:          8057 rows, of which 11 reference chapter_numbers
--     that don't exist in `chapters` for their (subject, grade)
--   chapter_content_sections: 0 rows (deprecated, dead)
--   chapter_topics:           0 rows (dead)
--
-- Plan:
--   1. Add chapters.subject_code (denorm of subjects.code via FK) for cleaner joins.
--   2. Backfill missing chapters rows from question_bank + chapter_concepts orphans
--      so no working content is dropped.
--   3. Add chapter_concepts.chapter_id UUID column + NOT VALID FK.
--   4. Backfill chapter_id by joining on (grade, subject_code, chapter_number).
--   5. Validate the FK.
--   6. Drop dead tables chapter_content_sections, chapter_topics
--      after defensive emptiness check.
--
-- Idempotent. Safe to re-run. No data dropped from chapter_concepts or question_bank.
--
-- Rollback:
--   ALTER TABLE chapter_concepts DROP CONSTRAINT IF EXISTS fk_chapter_concepts_chapter;
--   ALTER TABLE chapter_concepts DROP COLUMN IF EXISTS chapter_id;
--   ALTER TABLE chapters DROP COLUMN IF EXISTS subject_code;
--   -- The dead-table drops are not rolled back automatically; recreate from
--   -- migration history if absolutely needed.

BEGIN;

-- ─── 1. chapters.subject_code (denormalized FK to subjects.code) ──────────
ALTER TABLE chapters
  ADD COLUMN IF NOT EXISTS subject_code TEXT;

UPDATE chapters c
   SET subject_code = s.code
  FROM subjects s
 WHERE s.id = c.subject_id
   AND (c.subject_code IS NULL OR c.subject_code <> s.code);

-- Make NOT NULL once backfill is complete (safe — every chapter has a subject_id)
ALTER TABLE chapters
  ALTER COLUMN subject_code SET NOT NULL;

-- FK on subject_code (separate from subject_id; both kept until callers migrate)
DO $$ BEGIN
  ALTER TABLE chapters
    ADD CONSTRAINT fk_chapters_subject_code
    FOREIGN KEY (subject_code) REFERENCES subjects(code) ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_chapters_subject_code_grade_chapter
  ON chapters (subject_code, grade, chapter_number) WHERE is_active;

-- ─── 2. Backfill missing chapters rows from orphan question_bank ──────────
-- Orphan = (subject, grade, chapter_number) referenced by question_bank
-- but not present in chapters. Insert a minimal row so the FK is satisfied.
INSERT INTO chapters (subject_id, subject_code, grade, chapter_number, title, is_active, display_order)
SELECT DISTINCT
  s.id            AS subject_id,
  qb.subject      AS subject_code,
  qb.grade        AS grade,
  qb.chapter_number,
  'Chapter ' || qb.chapter_number AS title,
  TRUE            AS is_active,
  qb.chapter_number AS display_order
FROM question_bank qb
JOIN subjects s ON s.code = qb.subject
WHERE qb.chapter_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chapters c
     WHERE c.subject_id = s.id
       AND c.grade = qb.grade
       AND c.chapter_number = qb.chapter_number
  )
ON CONFLICT DO NOTHING;

-- ─── 3. Backfill missing chapters rows from orphan chapter_concepts ───────
INSERT INTO chapters (subject_id, subject_code, grade, chapter_number, title, is_active, display_order)
SELECT DISTINCT
  s.id            AS subject_id,
  cc.subject      AS subject_code,
  cc.grade        AS grade,
  cc.chapter_number,
  COALESCE(cc.chapter_title, 'Chapter ' || cc.chapter_number) AS title,
  TRUE            AS is_active,
  cc.chapter_number AS display_order
FROM chapter_concepts cc
JOIN subjects s ON s.code = cc.subject
WHERE NOT EXISTS (
    SELECT 1 FROM chapters c
     WHERE c.subject_id = s.id
       AND c.grade = cc.grade
       AND c.chapter_number = cc.chapter_number
  )
ON CONFLICT DO NOTHING;

-- ─── 4. chapter_concepts.chapter_id — soft FK to chapters ─────────────────
ALTER TABLE chapter_concepts
  ADD COLUMN IF NOT EXISTS chapter_id UUID;

UPDATE chapter_concepts cc
   SET chapter_id = c.id
  FROM chapters c
  JOIN subjects s ON s.id = c.subject_id
 WHERE s.code = cc.subject
   AND c.grade = cc.grade
   AND c.chapter_number = cc.chapter_number
   AND cc.chapter_id IS DISTINCT FROM c.id;

-- Pre-flight: confirm zero NULLs (we just backfilled; this guards regressions)
DO $$
DECLARE
  v_null_count INT;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM chapter_concepts WHERE chapter_id IS NULL;
  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % chapter_concepts rows still have NULL chapter_id. Investigate before re-running.', v_null_count;
  END IF;
END $$;

ALTER TABLE chapter_concepts
  ALTER COLUMN chapter_id SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE chapter_concepts
    ADD CONSTRAINT fk_chapter_concepts_chapter
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_chapter_concepts_chapter_id
  ON chapter_concepts (chapter_id);

-- ─── 5. question_bank.chapter — soft FK to chapters too ───────────────────
-- Add a denorm chapter_id column that downstream callers may use to avoid
-- recomputing the (subject_id, grade, chapter_number) join. Backfill in place.
ALTER TABLE question_bank
  ADD COLUMN IF NOT EXISTS chapter_id UUID;

UPDATE question_bank qb
   SET chapter_id = c.id
  FROM chapters c
  JOIN subjects s ON s.id = c.subject_id
 WHERE s.code = qb.subject
   AND c.grade = qb.grade
   AND c.chapter_number = qb.chapter_number
   AND qb.chapter_id IS DISTINCT FROM c.id;

CREATE INDEX IF NOT EXISTS idx_question_bank_chapter_id
  ON question_bank (chapter_id) WHERE chapter_id IS NOT NULL;

-- Soft FK (NOT VALID — some legacy rows may still be NULL chapter_number)
DO $$ BEGIN
  ALTER TABLE question_bank
    ADD CONSTRAINT fk_question_bank_chapter
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 6. Drop dead tables (with defensive emptiness check) ─────────────────
DO $$
DECLARE
  v_topics_count INT;
  v_sections_count INT;
BEGIN
  SELECT COUNT(*) INTO v_topics_count FROM chapter_topics;
  SELECT COUNT(*) INTO v_sections_count FROM chapter_content_sections;
  IF v_topics_count > 0 OR v_sections_count > 0 THEN
    RAISE EXCEPTION
      'Dead-table drop blocked: chapter_topics has % rows, chapter_content_sections has % rows. Investigate before dropping.',
      v_topics_count, v_sections_count;
  END IF;
END $$;

DROP TABLE IF EXISTS chapter_topics CASCADE;
DROP TABLE IF EXISTS chapter_content_sections CASCADE;

-- ─── 7. Update get_chapter_concepts to JOIN through chapters (and stay backwards-compatible) ───
-- The RPC signature is unchanged; the implementation now uses chapter_id when
-- available and falls back to the legacy (grade, subject, chapter_number) path
-- to remain compatible with any caller passing the legacy triple.
CREATE OR REPLACE FUNCTION get_chapter_concepts(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER
)
RETURNS TABLE(
  concept_id UUID,
  concept_number INTEGER,
  title TEXT,
  title_hi TEXT,
  learning_objective TEXT,
  learning_objective_hi TEXT,
  explanation TEXT,
  explanation_hi TEXT,
  key_formula TEXT,
  example_title TEXT,
  example_content TEXT,
  example_content_hi TEXT,
  common_mistakes JSONB,
  exam_tips JSONB,
  diagram_refs JSONB,
  diagram_description TEXT,
  practice_question TEXT,
  practice_options JSONB,
  practice_correct_index INTEGER,
  practice_explanation TEXT,
  difficulty INTEGER,
  bloom_level TEXT,
  estimated_minutes INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_grade TEXT;
  v_chapter_id UUID;
BEGIN
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  SELECT c.id INTO v_chapter_id
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
   WHERE s.code = p_subject
     AND c.grade = v_grade
     AND c.chapter_number = p_chapter_number
     AND c.is_active
   LIMIT 1;

  RETURN QUERY
  SELECT
    cc.id, cc.concept_number, cc.title, cc.title_hi,
    cc.learning_objective, cc.learning_objective_hi,
    cc.explanation, cc.explanation_hi, cc.key_formula,
    cc.example_title, cc.example_content, cc.example_content_hi,
    cc.common_mistakes, cc.exam_tips, cc.diagram_refs, cc.diagram_description,
    cc.practice_question, cc.practice_options, cc.practice_correct_index,
    cc.practice_explanation, cc.difficulty, cc.bloom_level, cc.estimated_minutes
  FROM chapter_concepts cc
  WHERE cc.is_active = TRUE
    AND (
      (v_chapter_id IS NOT NULL AND cc.chapter_id = v_chapter_id)
      OR (v_chapter_id IS NULL                                        -- safety fallback
          AND cc.grade = v_grade
          AND cc.subject = p_subject
          AND cc.chapter_number = p_chapter_number)
    )
  ORDER BY cc.concept_number ASC;
END;
$$;

-- ─── 8. Recompute subject readiness now that backfill may have added chapters ───
DO $$ BEGIN PERFORM compute_subject_content_readiness(); END $$;

INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'chapters.canonical_master.enabled',
  'system',
  NULL,
  jsonb_build_object(
    'enabled_at', now(),
    'note', 'chapters is now canonical; chapter_concepts.chapter_id FK added; dead tables dropped.'
  ),
  now()
);

COMMIT;
