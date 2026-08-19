-- Migration: 20260813144550_topic_diagrams_extraction_and_ncert_assets_bucket.sql
-- Purpose: Diagram/figure image extraction support for the NCERT ingestion
--          pipeline -- extends topic_diagrams, creates the public ncert-assets
--          Storage bucket, and adds an idempotency hash to rag_content_chunks.
--
-- ============================================================================
-- RECOVERY MIGRATION -- reconstructed file for an out-of-band production change
-- ============================================================================
-- WHY THIS FILE EXISTS (deploy-lane unblock, 2026-08-14):
--   Version 20260813144550 is recorded in production's
--   supabase_migrations.schema_migrations but had NO corresponding .sql file
--   in supabase/migrations/. supabase db push --linked --include-all
--   therefore aborted with "remote migration versions not found in local
--   migrations directory" BEFORE applying anything, so the migration-touching
--   deploy for PR #1541 (commit 76b0d1c6d, 2026-08-14) failed, stranding the
--   5 legitimately-pending migrations from that PR
--   (20260813085254, 20260815000006, 20260815000007, 20260816000001,
--   20260816000002).
--
--   The SQL below was recovered READ-ONLY from the statements column of
--   supabase_migrations.schema_migrations, provided directly by an operator
--   with production database access on 2026-08-14. This repos own automated
--   CI (deploy-production.yml) never ran at the 2026-08-13 14:45:50 UTC
--   timestamp this version implies -- confirmed via gh run list -- so this
--   was applied out-of-band, most likely a direct supabase db push from a
--   local session during the same-day P0 dashboard-stability incident arc.
--   No evidence this touched RBAC/RLS (P8/P9) -- the recovered statements
--   are entirely content-pipeline schema (diagram storage + ingestion
--   idempotency), not access-control.
--
-- ALREADY APPLIED ON PRODUCTION. Because 20260813144550 is already recorded
-- as applied there, the CLI will SKIP this file on prod -- it will not
-- re-run. It WILL run on a fresh database (CI live-DB, staging rebuild, DR
-- restore). Every statement in the original body already uses
-- IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING, so no additional
-- fresh-DB safety guards were needed -- it is naturally idempotent for a
-- single application as originally written.
--
-- ORIGINAL RATIONALE (reconstructed from statement content and comments --
-- no PR/commit message was recoverable; this migration was never committed
-- to git before now):
--   Adds diagram/figure image extraction support to topic_diagrams (storage
--   path + bucket, figure number, OCR text, image dimensions, sha256 hash for
--   dedup, source book, FK link to the nearest rag_content_chunks row,
--   extraction method, generated-description flag, confidence, updated_at
--   trigger) for the NCERT diagram-extraction pipeline
--   (scripts/ncert-ingestion/extract-diagrams.ts). Creates the PUBLIC
--   ncert-assets Storage bucket + public-read policy -- intentionally
--   public because NCERT textbook diagram images are non-sensitive
--   curriculum content, unlike the PRIVATE learning-sources bucket added
--   later by 20260816000001 for copyright-restricted source PDFs. Adds a
--   content_hash idempotency column to rag_content_chunks for the
--   ncert-ingestion pipeline (distinct from the unrelated
--   embedding_source_hash column added later by 20260816000002 for the
--   curated-corpus pipeline -- no collision, verified). Marks the legacy
--   content_media table as audit-only now that topic_diagrams is the
--   diagram source of truth, and registers topic_diagrams in
--   source_of_truth_registry.
--
-- RECOVERED STATEMENTS (verbatim from production; only this header banner
-- was added -- no SQL was changed):
-- ============================================================================

BEGIN;

ALTER TABLE public.topic_diagrams
  ADD COLUMN IF NOT EXISTS storage_path         text,
  ADD COLUMN IF NOT EXISTS storage_bucket        text DEFAULT 'ncert-assets',
  ADD COLUMN IF NOT EXISTS figure_number         text,
  ADD COLUMN IF NOT EXISTS ocr_text              text,
  ADD COLUMN IF NOT EXISTS image_width           integer,
  ADD COLUMN IF NOT EXISTS image_height          integer,
  ADD COLUMN IF NOT EXISTS image_hash            text,
  ADD COLUMN IF NOT EXISTS source_book           text,
  ADD COLUMN IF NOT EXISTS linked_chunk_id       uuid REFERENCES public.rag_content_chunks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extraction_method     text,
  ADD COLUMN IF NOT EXISTS generated_description boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS confidence            numeric,
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz DEFAULT now() NOT NULL;

COMMENT ON COLUMN public.topic_diagrams.storage_path IS
  'Path within the ncert-assets Storage bucket for the extracted/cropped image file, e.g. class-07/science/chapter-04/page-052/figure-01.webp.';
COMMENT ON COLUMN public.topic_diagrams.image_hash IS
  'sha256 of the extracted image bytes. Dedup key: re-running extraction on an unchanged page must not create a duplicate row.';
COMMENT ON COLUMN public.topic_diagrams.linked_chunk_id IS
  'FK to the nearest rag_content_chunks row (same page/chapter) this diagram supports -- the content_asset_links relationship the original design doc called for, implemented as a direct FK rather than a join table since it is always one-diagram-to-one-nearest-chunk.';
COMMENT ON COLUMN public.topic_diagrams.extraction_method IS
  'How this row was produced, e.g. pdf_embedded_image_v1 (pdfimages-extracted raster), vision_page_crop_v1 (rendered page + vision-model crop), manual.';
COMMENT ON COLUMN public.topic_diagrams.generated_description IS
  'true when alt_text/caption came from a vision-model description rather than the PDF''s own figure caption text.';

CREATE INDEX IF NOT EXISTS topic_diagrams_image_hash_idx
  ON public.topic_diagrams (image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS topic_diagrams_linked_chunk_idx
  ON public.topic_diagrams (linked_chunk_id) WHERE linked_chunk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS topic_diagrams_grade_subject_chapter_idx
  ON public.topic_diagrams (grade, subject, chapter_number);

CREATE OR REPLACE FUNCTION public.topic_diagrams_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS topic_diagrams_updated_at_trg ON public.topic_diagrams;
CREATE TRIGGER topic_diagrams_updated_at_trg
  BEFORE UPDATE ON public.topic_diagrams
  FOR EACH ROW EXECUTE FUNCTION public.topic_diagrams_set_updated_at();

INSERT INTO storage.buckets (id, name, public)
VALUES ('ncert-assets', 'ncert-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ncert_assets_public_read" ON storage.objects;
CREATE POLICY "ncert_assets_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'ncert-assets');

ALTER TABLE public.rag_content_chunks
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN public.rag_content_chunks.content_hash IS
  'sha256 of grade_short|subject_code|chapter_number|chunk_index|normalized chunk_text. '
  'Unifies the two ncert-ingestion entry points onto one idempotency strategy: same hash '
  '-> unchanged, skip; different hash for the same (grade,subject,chapter,chunk_index) -> '
  'content edited, upsert. NULL on pre-existing rows (backfill out of scope here).';

CREATE UNIQUE INDEX IF NOT EXISTS rag_content_chunks_active_ncert_hash_idx
  ON public.rag_content_chunks (content_hash)
  WHERE content_hash IS NOT NULL AND is_active = true AND source = 'ncert_2025';

COMMENT ON TABLE public.content_media IS
  'LEGACY / AUDIT-ONLY as of 2026-08-13. Real extracted diagram assets now live in '
  'topic_diagrams (populated by scripts/ncert-ingestion/extract-diagrams.ts; see '
  'source_of_truth_registry). Retained (not dropped) because the generate-concepts '
  'Edge Function still reads it as LLM context and extract-diagrams/embed-diagrams '
  'still write the text-proxy figure-mention rows that feed rag_content_chunks.media_url '
  'citations in Foxy. Do not build new features against this table.';

INSERT INTO public.source_of_truth_registry (
  capability_fact, canonical_write_path, authoritative_store, owner,
  identity_grain, tenant_scope, history_policy, retention_deletion_rule,
  recovery_method, derived_consumers, consistency_expectation, effective_from
) VALUES (
  'Diagram/figure image extracted and linked to curriculum content',
  'scripts/ncert-ingestion/extract-diagrams.ts -> topic_diagrams INSERT',
  'topic_diagrams',
  'content',
  'topic_diagrams.id (one row per extracted diagram image)',
  'Global: shared NCERT curriculum content, not tenant/school-scoped',
  'append_only',
  'corpus_life (kept as long as the source NCERT PDF/curriculum edition is active; superseded rows soft-deleted via is_active=false)',
  're-run scripts/ncert-ingestion/extract-diagrams.ts against the source PDF in ncert-books; images also recoverable from Storage bucket backups',
  ARRAY['FoxyStructuredRenderer DiagramBlock', 'rag_content_chunks (via linked_chunk_id)'],
  'manual',
  now()
)
ON CONFLICT DO NOTHING;

COMMIT;
