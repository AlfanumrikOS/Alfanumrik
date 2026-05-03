-- Migration: 20260503200000_add_rag_pack_provenance.sql
-- Phase 4.5 of Goal-Adaptive Learning Layers - Content Pack Ingestion.
-- Pure additive: adds 3 nullable tracking columns to rag_content_chunks.
-- All existing rows get NULL values (no behavior change).
--
-- Owner: ai-engineer (ingestion) + assessment (curriculum review) + architect (schema)
-- Added: 2026-05-03
--
-- Columns added (all nullable):
--   pack_id        text   -- which content pack this chunk belongs to (e.g. cbse-board-pyq-math-grade10)
--   pack_version   text   -- semver-style version of that pack (e.g. v1, 1.2.3)
--   provenance     text   -- one of: licensed, public_domain, generated, curated; nullable for legacy rows
--
-- The provenance CHECK constraint allows NULL so that existing legacy rows
-- (which have no pack metadata) remain valid. New inserts via the ingestion
-- script must supply a non-NULL provenance value.
--
-- Why this matters:
--   - pack_id + pack_version enable selective retraction (e.g. delete v1.0 of jee_archive
--     and replace with v1.1 without affecting NCERT chunks)
--   - provenance enables legal audit trails and selective filtering
--     (e.g. for a free-tier student, retrieve only public_domain + curated content)
--
-- Rollback: ALTER TABLE rag_content_chunks DROP COLUMN pack_id, DROP COLUMN pack_version, DROP COLUMN provenance;
-- (DROP COLUMN requires user approval per CLAUDE.md - additive only by default).

ALTER TABLE public.rag_content_chunks
  ADD COLUMN IF NOT EXISTS pack_id text,
  ADD COLUMN IF NOT EXISTS pack_version text,
  ADD COLUMN IF NOT EXISTS provenance text;

-- CHECK constraint added separately so the column-add stays IF NOT EXISTS-safe.
-- The constraint accepts NULL (legacy rows have no provenance).
DO $checkconstraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name = 'rag_content_chunks_provenance_chk'
  ) THEN
    ALTER TABLE public.rag_content_chunks
      ADD CONSTRAINT rag_content_chunks_provenance_chk
      CHECK (provenance IS NULL OR provenance IN ('licensed','public_domain','generated','curated'));
  END IF;
END $checkconstraint$;

-- Index on (pack_id, pack_version) for selective-retraction queries.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_pack
  ON public.rag_content_chunks (pack_id, pack_version)
  WHERE pack_id IS NOT NULL;

COMMENT ON COLUMN public.rag_content_chunks.pack_id IS
  'Phase 4.5: identifier of the content pack this chunk was ingested from. NULL for legacy NCERT chunks. See src/lib/rag/pack-manifest.ts for ingestion contract.';
COMMENT ON COLUMN public.rag_content_chunks.pack_version IS
  'Phase 4.5: semver-style version of the source pack. Bumped on any pack change. NULL for legacy chunks.';
COMMENT ON COLUMN public.rag_content_chunks.provenance IS
  'Phase 4.5: governance tag - one of licensed, public_domain, generated, curated. NULL for legacy chunks (treat as unknown). Filtered selectively per plan/jurisdiction.';

DO $verify$
DECLARE
  v_cols int;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'rag_content_chunks'
     AND column_name IN ('pack_id','pack_version','provenance');
  RAISE NOTICE 'Phase 4.5: rag_content_chunks pack provenance columns present (count=%/3)', v_cols;
  IF v_cols < 3 THEN
    RAISE WARNING 'Phase 4.5: expected 3 new columns on rag_content_chunks, found %', v_cols;
  END IF;
END $verify$;
