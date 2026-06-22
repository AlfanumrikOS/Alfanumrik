-- Migration: 20260622010000_chapter_concepts_chapter_id_nullable.sql
-- Purpose: Drop the NOT NULL constraint on public.chapter_concepts.chapter_id so
--          the chapter-concepts generator can insert curated concept rows for
--          chapters that have no row in the legacy public.chapters catalog.
--
-- Why this is needed
-- ------------------
-- The chapter-concepts generator fails for grade-11/12 commerce & humanities
-- subjects with `failed_db — no chapters row (FK unresolvable)`. The cause:
--   * chapter_concepts.chapter_id was declared `uuid NOT NULL` with FK
--     fk_chapter_concepts_chapter -> public.chapters(id) (added in legacy
--     migration 20260415000014_chapters_canonical_master.sql).
--   * The legacy `chapters` catalog has NO rows for those subjects (418
--     chapters blocked), so there is no chapter_id to resolve, and the
--     NOT NULL + FK pair makes the INSERT impossible.
--
-- The curated-reader path does NOT use chapter_id. The Chapter Reader v2 reader
-- (src/lib/chapter-reader/get-concepts-from-table.ts) keys rows on
-- (grade, subject, chapter_number, is_active) via the idx_cc_chapter index and
-- the uq_chapter_concepts_grade_subject_chapter_concept unique constraint.
-- For this path the chapter_id FK is vestigial.
--
-- What this migration does (and does NOT do)
-- ------------------------------------------
--   * DROP NOT NULL on chapter_id only. A nullable FK is valid in Postgres:
--     a NULL value bypasses the FK check, so rows can be inserted without a
--     matching chapters row, while non-NULL values are still validated.
--   * Keeps the chapter_id column.            (NOT dropped)
--   * Keeps the fk_chapter_concepts_chapter FK constraint. (NOT dropped)
--   * Keeps the idx_chapter_concepts_chapter_id index.     (NOT dropped)
--   * RLS unchanged (cc_public_read / cc_service_all stay as-is).
--
-- Idempotent: guarded by an information_schema check; ALTER ... DROP NOT NULL
-- is also itself safe to re-run, but the guard avoids a redundant DDL no-op.
--
-- Rollback note (do NOT run blindly): re-adding NOT NULL requires every row to
-- have a non-NULL chapter_id first, which is exactly the precondition this
-- migration removes. A compensating migration would need to backfill chapter_id
-- (or accept the column staying nullable) before
-- `ALTER TABLE public.chapter_concepts ALTER COLUMN chapter_id SET NOT NULL;`.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'chapter_concepts'
      AND column_name  = 'chapter_id'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.chapter_concepts
      ALTER COLUMN chapter_id DROP NOT NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.chapter_concepts.chapter_id IS
  'Soft FK to public.chapters(id). Nullable since 20260622010000: the legacy '
  'chapters catalog is incomplete (no rows for many G11/G12 commerce & '
  'humanities chapters), and the Chapter Reader v2 path keys on '
  '(grade, subject, chapter_number, is_active) rather than chapter_id. '
  'NULL bypasses the fk_chapter_concepts_chapter FK check; non-NULL values '
  'are still validated against public.chapters(id).';

-- End of migration: 20260622010000_chapter_concepts_chapter_id_nullable.sql
-- Column altered: chapter_concepts.chapter_id (DROP NOT NULL). FK + index + RLS unchanged.
