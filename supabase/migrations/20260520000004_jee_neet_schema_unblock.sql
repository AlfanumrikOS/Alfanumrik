-- Migration: 20260520000004_jee_neet_schema_unblock.sql
-- Purpose:    PR-1 of the JEE/NEET/Olympiad scaling roadmap. Unblocks
--             ingestion of competitive-exam content by widening two CHECK
--             constraints and adding 6 nullable PYQ-tracking columns to
--             question_bank.
--
-- Why this matters (architect's roadmap, 2026-05-19):
--   - question_bank has 14,000 rows today: 8057 'practice', 5445 'cbse_style',
--     494 'ncert_exercise'. ZERO rows tagged jee_archive / neet_archive /
--     olympiad. The CHECK constraint `chk_source_type` physically rejects
--     those inserts (allows only ncert_intext, ncert_exercise, ncert_example,
--     cbse_style, practice).
--   - rag_content_chunks.`rag_chunks_source_ncert_only` likewise restricts
--     `source` to the single literal 'ncert_2025', blocking non-NCERT
--     reference material (JEE/NEET archives, Olympiad solutions, board
--     papers) from being added to the RAG corpus.
--   - 1 student already wants `competitive_exam` goal — currently the
--     content layer cannot serve them.
--
-- What this migration changes:
--   1. Widens chk_source_type on question_bank to additionally allow
--      jee_archive, neet_archive, olympiad, board_paper, pyq, curated.
--   2. Widens rag_chunks_source_ncert_only on rag_content_chunks to allow
--      ncert_2025 (existing), jee_archive, neet_archive, olympiad,
--      board_paper, pyq, curated.
--   3. Adds 6 nullable PYQ-tracking columns to question_bank:
--        exam_session text          (e.g. 'jee_main_jan_2024')
--        question_number text       (paper question number)
--        marks_correct numeric(4,2) (e.g. 4.00 for JEE/NEET)
--        marks_wrong numeric(4,2)   (e.g. -1.00; non-negative grading: 0)
--        paper_pattern text         (CHECK constrained — see below)
--        exam_paper_id uuid         (forward reference; FK added later)
--   4. Adds two partial indexes for PYQ-lookup query performance.
--
-- What this migration does NOT do:
--   - No data is modified or dropped. All 14k existing question_bank rows
--     and all existing rag_content_chunks rows survive unchanged.
--   - No RLS policy is touched.
--   - No FK is added on exam_paper_id (the `exam_papers` table doesn't
--     exist yet; FK lands in a follow-up PR with that table).
--   - The pack_id / pack_version / provenance columns added by
--     20260503200000_add_rag_pack_provenance.sql are NOT touched.
--
-- What this migration enables:
--   - PR-2 (`bulk-jee-neet-import` Edge Function) can now insert rows with
--     source_type='jee_archive'|'neet_archive'|'olympiad' into question_bank.
--   - RAG ingestion can now write non-NCERT chunks (still subject to the
--     abstain gate and grounding contract in Foxy retrieval — P12).
--
-- Idempotent: yes. CHECK constraint drops/adds are wrapped in
--   pg_constraint existence checks. Column adds use IF NOT EXISTS. Index
--   creation uses IF NOT EXISTS.
--
-- Owner: architect (schema/RLS) + ai-engineer (ingestion downstream).
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   1. Drop the two partial indexes:
--        DROP INDEX IF EXISTS idx_qb_pyq_lookup;
--        DROP INDEX IF EXISTS idx_qb_paper_pattern;
--   2. Re-narrow chk_source_type back to the original 5 values (this only
--      succeeds if no rows have been inserted with the new types — check
--      first with SELECT count(*) FROM question_bank WHERE source_type
--      IN ('jee_archive','neet_archive','olympiad','board_paper','pyq','curated')).
--   3. Re-narrow rag_chunks_source_ncert_only back to source = 'ncert_2025'
--      (same precondition — verify no non-NCERT rows exist).
--   4. ALTER TABLE question_bank DROP COLUMN exam_session, DROP COLUMN
--      question_number, DROP COLUMN marks_correct, DROP COLUMN marks_wrong,
--      DROP COLUMN paper_pattern, DROP COLUMN exam_paper_id, DROP COLUMN
--      chk_paper_pattern (constraint).
--   DROP COLUMN requires user approval per CLAUDE.md — additive only by
--   default.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Widen question_bank.chk_source_type
--    Original (per baseline_from_prod.sql line 2226):
--      CHECK source_type IN ('ncert_intext','ncert_exercise','ncert_example','cbse_style','practice')
--    Widened set adds:
--      jee_archive   — JEE Main/Advanced previous-year questions
--      neet_archive  — NEET previous-year questions
--      olympiad      — Physics/Chem/Math/Bio Olympiad questions
--      board_paper   — CBSE board paper questions (distinct from cbse_style)
--      pyq           — generic previous-year question (multi-board)
--      curated       — manually curated by editorial team (non-AI source)
-- ───────────────────────────────────────────────────────────────────────

DO $widen_qb_source_type$
BEGIN
  -- Drop the old narrow constraint if present. Inside a DO block so we
  -- can guard with pg_constraint and stay idempotent on re-run.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_source_type'
       AND pg_class.relname = 'question_bank'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.question_bank DROP CONSTRAINT chk_source_type;
  END IF;

  -- Add the widened constraint. Guard so a re-run after a successful
  -- previous run is a no-op (the DROP above only fires if the OLD narrow
  -- constraint exists; the ADD only fires if there's no constraint by
  -- this name at all).
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_source_type'
       AND pg_class.relname = 'question_bank'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.question_bank
      ADD CONSTRAINT chk_source_type
      CHECK (source_type = ANY (ARRAY[
        'ncert_intext'::text,
        'ncert_exercise'::text,
        'ncert_example'::text,
        'cbse_style'::text,
        'practice'::text,
        'jee_archive'::text,
        'neet_archive'::text,
        'olympiad'::text,
        'board_paper'::text,
        'pyq'::text,
        'curated'::text
      ]));
  END IF;
END $widen_qb_source_type$;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Widen rag_content_chunks.rag_chunks_source_ncert_only
--    Original (per baseline_from_prod.sql line 10173):
--      CHECK source = 'ncert_2025'
--    Widened set keeps 'ncert_2025' (so existing rows stay valid) and
--    additionally allows the same six new sources used by question_bank
--    plus the original literal. We keep the constraint name
--    rag_chunks_source_ncert_only so downstream code grep'ing for it
--    still finds it; the original name is now misleading but renaming
--    would break any external schema lints / docs that reference it.
--    A future cleanup migration can rename it once the team is ready.
-- ───────────────────────────────────────────────────────────────────────

DO $widen_rag_source$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'rag_chunks_source_ncert_only'
       AND pg_class.relname = 'rag_content_chunks'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.rag_content_chunks DROP CONSTRAINT rag_chunks_source_ncert_only;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'rag_chunks_source_ncert_only'
       AND pg_class.relname = 'rag_content_chunks'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.rag_content_chunks
      ADD CONSTRAINT rag_chunks_source_ncert_only
      CHECK (source = ANY (ARRAY[
        'ncert_2025'::text,
        'jee_archive'::text,
        'neet_archive'::text,
        'olympiad'::text,
        'board_paper'::text,
        'pyq'::text,
        'curated'::text
      ]));
  END IF;
END $widen_rag_source$;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Add 6 nullable PYQ-tracking columns to question_bank
--    All nullable so the 14k existing rows remain valid (they have no
--    PYQ metadata to backfill). The paper_pattern CHECK accepts NULL for
--    the same reason.
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS exam_session text,
  ADD COLUMN IF NOT EXISTS question_number text,
  ADD COLUMN IF NOT EXISTS marks_correct numeric(4,2),
  ADD COLUMN IF NOT EXISTS marks_wrong numeric(4,2),
  ADD COLUMN IF NOT EXISTS paper_pattern text,
  ADD COLUMN IF NOT EXISTS exam_paper_id uuid;

-- paper_pattern CHECK constraint, added separately so the ALTER TABLE
-- above stays IF NOT EXISTS-clean on re-run.
DO $paper_pattern_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_paper_pattern'
       AND pg_class.relname = 'question_bank'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.question_bank
      ADD CONSTRAINT chk_paper_pattern
      CHECK (paper_pattern IS NULL OR paper_pattern = ANY (ARRAY[
        'mcq_single'::text,
        'mcq_multi'::text,
        'integer'::text,
        'numerical'::text,
        'matching'::text,
        'comprehension'::text,
        'assertion_reason'::text,
        'subjective_proof'::text
      ]));
  END IF;
END $paper_pattern_check$;

-- ───────────────────────────────────────────────────────────────────────
-- 4. Partial indexes for PYQ-lookup performance
--    Partial (WHERE clauses) so they don't bloat the index for the 13k+
--    existing rows that have no PYQ metadata.
-- ───────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_qb_pyq_lookup
  ON public.question_bank (source_type, exam_session)
  WHERE source_type IN ('jee_archive','neet_archive','olympiad','pyq');

CREATE INDEX IF NOT EXISTS idx_qb_paper_pattern
  ON public.question_bank (paper_pattern)
  WHERE paper_pattern IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 5. Column comments (self-documentation)
-- ───────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.question_bank.exam_session IS
  'JEE/NEET roadmap PR-1 (2026-05-20): identifier of the exam session/paper this question came from. Examples: ''jee_main_jan_2024'', ''jee_advanced_p1_2024'', ''neet_2024'', ''nsep_2023''. NULL for non-PYQ rows.';
COMMENT ON COLUMN public.question_bank.question_number IS
  'JEE/NEET roadmap PR-1 (2026-05-20): the question''s position in the original paper. Free-form text to accommodate ''Q42'', ''Sec-A Q3'', ''Part II.5'', etc. NULL for non-PYQ rows.';
COMMENT ON COLUMN public.question_bank.marks_correct IS
  'JEE/NEET roadmap PR-1 (2026-05-20): marks awarded for a correct answer in the original paper. Typically 4.00 for JEE/NEET; varies for Olympiad. NULL means use default 1.00 from the marks column.';
COMMENT ON COLUMN public.question_bank.marks_wrong IS
  'JEE/NEET roadmap PR-1 (2026-05-20): marks deducted for a wrong answer in the original paper. Negative for penalty grading (e.g. -1.00 JEE/NEET); 0 for non-negative grading. NULL means the original paper''s scheme is unknown.';
COMMENT ON COLUMN public.question_bank.paper_pattern IS
  'JEE/NEET roadmap PR-1 (2026-05-20): which paper pattern this question uses. One of mcq_single, mcq_multi, integer, numerical, matching, comprehension, assertion_reason, subjective_proof; or NULL for legacy/practice rows. Constrained by chk_paper_pattern.';
COMMENT ON COLUMN public.question_bank.exam_paper_id IS
  'JEE/NEET roadmap PR-1 (2026-05-20): forward reference to the exam_papers table (not yet created — added in a follow-up PR). No FK constraint enforced yet. Will become a real FK once exam_papers lands.';

-- ───────────────────────────────────────────────────────────────────────
-- 6. Verification block — RAISE NOTICE counts so the migration log
--    self-documents whether the changes landed.
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_new_cols int;
  v_qb_constraint_widened boolean;
  v_rag_constraint_widened boolean;
  v_pyq_index_present boolean;
  v_pattern_index_present boolean;
  v_pattern_constraint_present boolean;
  rec record;
BEGIN
  -- Count the 6 new columns
  SELECT count(*) INTO v_new_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'question_bank'
     AND column_name IN (
       'exam_session','question_number','marks_correct',
       'marks_wrong','paper_pattern','exam_paper_id'
     );

  -- Verify chk_source_type now accepts jee_archive (heuristic: check the
  -- constraint definition contains the literal). We inspect pg_constraint
  -- because information_schema doesn't expose the CHECK clause text.
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'chk_source_type'
       AND t.relname = 'question_bank'
       AND t.relnamespace = 'public'::regnamespace
       AND pg_get_constraintdef(c.oid) LIKE '%jee_archive%'
  ) INTO v_qb_constraint_widened;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'rag_chunks_source_ncert_only'
       AND t.relname = 'rag_content_chunks'
       AND t.relnamespace = 'public'::regnamespace
       AND pg_get_constraintdef(c.oid) LIKE '%jee_archive%'
  ) INTO v_rag_constraint_widened;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_qb_pyq_lookup'
  ) INTO v_pyq_index_present;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_qb_paper_pattern'
  ) INTO v_pattern_index_present;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'chk_paper_pattern'
       AND t.relname = 'question_bank'
       AND t.relnamespace = 'public'::regnamespace
  ) INTO v_pattern_constraint_present;

  RAISE NOTICE 'JEE/NEET PR-1: question_bank PYQ columns present (%/6)', v_new_cols;
  RAISE NOTICE 'JEE/NEET PR-1: chk_source_type widened to accept jee_archive: %', v_qb_constraint_widened;
  RAISE NOTICE 'JEE/NEET PR-1: rag_chunks_source_ncert_only widened to accept jee_archive: %', v_rag_constraint_widened;
  RAISE NOTICE 'JEE/NEET PR-1: idx_qb_pyq_lookup present: %', v_pyq_index_present;
  RAISE NOTICE 'JEE/NEET PR-1: idx_qb_paper_pattern present: %', v_pattern_index_present;
  RAISE NOTICE 'JEE/NEET PR-1: chk_paper_pattern present: %', v_pattern_constraint_present;

  -- Existing-row distribution (helps confirm no data was lost in the
  -- constraint swap).
  RAISE NOTICE 'JEE/NEET PR-1: question_bank row counts by source_type after migration:';
  FOR rec IN
    SELECT source_type, count(*) AS n
      FROM public.question_bank
     GROUP BY source_type
     ORDER BY n DESC
  LOOP
    RAISE NOTICE '  source_type=% rows=%', rec.source_type, rec.n;
  END LOOP;

  IF v_new_cols < 6
     OR NOT v_qb_constraint_widened
     OR NOT v_rag_constraint_widened
     OR NOT v_pyq_index_present
     OR NOT v_pattern_index_present
     OR NOT v_pattern_constraint_present THEN
    RAISE WARNING 'JEE/NEET PR-1: migration did NOT land cleanly — see counts above';
  ELSE
    RAISE NOTICE 'JEE/NEET PR-1: MIGRATION COMPLETE — JEE/NEET/Olympiad ingestion unblocked';
  END IF;
END $verify$;

COMMIT;
