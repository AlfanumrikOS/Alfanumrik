-- Migration: 20260816000002_curated_learning_corpus.sql
-- Purpose:    Phases 0 + 3 of the curated-PDF learning-corpus program. Adds the
--             provenance / extraction / rights columns needed to ingest
--             operator-curated PDFs alongside the existing NCERT corpus, and
--             ADOPTS the three empty rag_content_* scaffolding tables that have
--             existed unused since the baseline.
--
-- Owner: architect (schema/RLS).
-- Sibling: 20260816000001_learning_sources_bucket.sql (storage).
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION CHANGES
-- ─────────────────────────────────────────────────────────────────────────
--   1. public.rag_content_chunks — 7 nullable columns + 1 NULL-permitting
--      CHECK (chk_rag_unit_type) + 1 partial index. No existing constraint is
--      touched.
--   2. public.rag_content_sources — rights_status (NOT NULL DEFAULT
--      'restricted') + rights_notes. This is the copyright control.
--   3. public.rag_content_documents — storage/extraction/classification
--      columns, a UNIQUE dedupe index on file_sha256, and the two approval
--      audit columns that turned out to be MISSING (see "CORRECTION" below).
--   4. An RLS ASSERTION block over all three tables (P8).
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ─────────────────────────────────────────────────────────────────────────
-- Every item here is a load-bearing "do not touch". Verified against
-- 00000000000000_baseline_from_prod.sql:10126-10175.
--
-- (a) chk_rag_content_type is NOT widened.
--     It stays CHECK (content_type IN ('content','diagram','qa')). content_type
--     is a RETRIEVAL-FACING output column whose 3-value meaning is contracted
--     with downstream consumers. The new `unit_type` is the FINE axis; every
--     unit type maps DOWN onto one of the existing 3 values. The ingestor MUST
--     set both:
--
--       unit_type            -> content_type   question_type
--       ------------------------------------------------------------------
--       concept_explanation  -> 'content'      NULL
--       definition           -> 'content'      NULL
--       worked_example       -> 'content'      'example'
--       qa_pair              -> 'qa'           'short_answer' | 'long_answer'
--                                              | 'intext' | 'exercise' | 'hots'
--       mcq                  -> 'qa'           'mcq'
--       diagram_caption      -> 'diagram'      NULL
--       table                -> 'content'      NULL
--
-- (b) chk_rag_question_type is NOT widened.
--     It stays the existing 8 values (mcq, short_answer, long_answer,
--     numerical, intext, exercise, example, hots). See the mapping above —
--     every new unit type lands inside those 8 (or NULL).
--
-- (c) rag_chunks_source_ncert_only is NOT touched.
--     VERIFIED: migration 20260520000004_jee_neet_schema_unblock.sql:167-177
--     already widened this constraint to
--       source IN ('ncert_2025','jee_archive','neet_archive','olympiad',
--                  'board_paper','pyq','curated')
--     'curated' is ALREADY in the allowed set. A future reader looking at the
--     baseline DDL alone will see the original narrow `source = 'ncert_2025'`
--     and be tempted to re-widen it here. DO NOT. It is already done, and
--     re-running a DROP/ADD of that constraint on a table that by then holds
--     non-NCERT rows is a needless full-table revalidation.
--     (The constraint NAME is now misleading — that rename is tracked
--     separately and is not this migration's job.)
--
-- (d) The search_vector trigger is NOT modified.
--     trg_rag_search_vector (baseline:18560) fires BEFORE INSERT OR UPDATE OF
--     chunk_text and calls update_rag_search_vector() (baseline:8523). FTS must
--     keep indexing chunk_text ONLY.
--     Why this matters: `embedding_text` is a metadata-PREFIXED composite
--     ("Board: CBSE / Grade: 10 / Subject: science / ... <chunk text>"). It is
--     built to be VECTORIZED, not to be tokenised into a tsvector. If those
--     prefixes entered every row's search_vector, terms like 'cbse', 'grade',
--     '10' and 'science' would become near-ubiquitous, their IDF would collapse,
--     and ts_rank would be skewed across the ENTIRE ~16,006-row corpus — not
--     just the new curated rows. That is a silent, global retrieval-quality
--     regression with no error to catch it.
--
-- (e) No table is created, so no new RLS policy is written. Section 4 ASSERTS
--     the inherited posture instead of assuming it (P8).
--
-- (f) No DROP of anything. No modification of any pre-existing row. Additive
--     only. All ~16,006 existing rag_content_chunks rows and every existing
--     constraint survive unchanged.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CORRECTION TO THE ORIGINAL SPEC (architect, 2026-08-13)
-- ─────────────────────────────────────────────────────────────────────────
-- The task brief stated that rag_content_documents already carries
-- approval_status, approved_by AND approved_at. Verified against
-- baseline_from_prod.sql:12973-12992 and apps/host/src/types/database.types.ts
-- :14697-14717 — only `approval_status text DEFAULT 'pending' NOT NULL` exists.
-- `approved_by` and `approved_at` exist on rag_content_SOURCES (baseline:13023-
-- 13024) but NOT on documents. An approval workflow with no record of WHO
-- approved and WHEN is not auditable, so this migration adds those two columns
-- to documents. Both use ADD COLUMN IF NOT EXISTS, so this is a no-op on any
-- environment where they do already exist.
--
-- ─────────────────────────────────────────────────────────────────────────
-- FAIL-SAFE DEFAULTS (deliberate NOT NULL choices)
-- ─────────────────────────────────────────────────────────────────────────
-- rights_status  NOT NULL DEFAULT 'restricted'
-- needs_review   NOT NULL DEFAULT true
--   Both are gates. A nullable gate column has a third, ambiguous state that
--   every consumer must remember to handle, and the failure mode of forgetting
--   is "content goes live". NOT NULL forces the safe value to be the one you
--   get by omission and makes "unset" unrepresentable. Both tables are empty
--   scaffolding today, and Postgres 11+ applies the fast default without a
--   table rewrite, so this is safe on non-empty environments too.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Idempotent: yes.
--   - Column adds use ADD COLUMN IF NOT EXISTS.
--   - CHECK constraints are added inside DO $name$ blocks guarded on
--     pg_constraint JOIN pg_class WITH relnamespace = 'public'::regnamespace.
--   - Indexes use CREATE INDEX IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT
--     EXISTS.
--   - COMMENT ON is inherently idempotent.
--   - The verification blocks are read-only.
--   Safe to run twice. Second run is a no-op that re-emits the NOTICEs.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual; DROP COLUMN requires user approval per CLAUDE.md —
--           this repo is additive-only by default)
-- ─────────────────────────────────────────────────────────────────────────
-- PRECONDITIONS — verify ALL of these return 0 before dropping anything.
-- Any non-zero result means live data depends on these columns and the
-- rollback would destroy provenance/rights information that cannot be
-- reconstructed from the remaining columns.
--
--   P1) SELECT count(*) FROM public.rag_content_chunks WHERE unit_type IS NOT NULL;
--   P2) SELECT count(*) FROM public.rag_content_chunks WHERE embedding_text IS NOT NULL
--        OR embedding_source_hash IS NOT NULL OR heading_path IS NOT NULL
--        OR page_start IS NOT NULL OR page_end IS NOT NULL
--        OR extraction_version IS NOT NULL;
--   P3) SELECT count(*) FROM public.rag_content_chunks WHERE source <> 'ncert_2025';
--   P4) SELECT count(*) FROM public.rag_content_documents;
--   P5) SELECT count(*) FROM public.rag_content_sources;
--   P6) SELECT count(*) FROM storage.objects WHERE bucket_id = 'learning-sources';
--
-- If (and only if) all six are 0:
--   Step 1 — indexes (always safe, no data loss):
--     DROP INDEX IF EXISTS public.idx_rag_chunks_curated_lookup;
--     DROP INDEX IF EXISTS public.rag_content_documents_file_sha256_uq;
--     DROP INDEX IF EXISTS public.idx_rag_docs_storage_path;
--     DROP INDEX IF EXISTS public.idx_rag_docs_extraction_queue;
--   Step 2 — constraints (always safe, no data loss):
--     ALTER TABLE public.rag_content_chunks    DROP CONSTRAINT IF EXISTS chk_rag_unit_type;
--     ALTER TABLE public.rag_content_documents DROP CONSTRAINT IF EXISTS chk_rag_docs_extraction_status;
--     ALTER TABLE public.rag_content_documents DROP CONSTRAINT IF EXISTS chk_rag_docs_grade_short;
--     ALTER TABLE public.rag_content_documents DROP CONSTRAINT IF EXISTS chk_rag_docs_sha256_format;
--     ALTER TABLE public.rag_content_sources   DROP CONSTRAINT IF EXISTS chk_rag_sources_rights_status;
--   Step 3 — columns (DESTRUCTIVE; USER APPROVAL REQUIRED):
--     ALTER TABLE public.rag_content_chunks
--       DROP COLUMN embedding_text, DROP COLUMN embedding_source_hash,
--       DROP COLUMN unit_type, DROP COLUMN heading_path,
--       DROP COLUMN page_start, DROP COLUMN page_end,
--       DROP COLUMN extraction_version;
--     ALTER TABLE public.rag_content_sources
--       DROP COLUMN rights_status, DROP COLUMN rights_notes;
--     ALTER TABLE public.rag_content_documents
--       DROP COLUMN storage_bucket, DROP COLUMN storage_path,
--       DROP COLUMN file_sha256, DROP COLUMN page_count,
--       DROP COLUMN extraction_status, DROP COLUMN extraction_version,
--       DROP COLUMN needs_review, DROP COLUMN language,
--       DROP COLUMN grade_short, DROP COLUMN subject_code,
--       DROP COLUMN approved_by, DROP COLUMN approved_at;
--   Step 4 — regenerate apps/host/src/types/database.types.ts.
--
-- A PARTIAL rollback (Steps 1+2 only) is always safe and is the preferred
-- emergency action: it removes the new constraints/indexes while leaving all
-- data intact, and this migration can then simply be re-run.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. public.rag_content_chunks — additive provenance/extraction columns
-- ═══════════════════════════════════════════════════════════════════════
-- All 7 columns are NULLABLE with no default. That is what keeps the
-- ~16,006 existing NCERT rows valid without touching a single one of them.

ALTER TABLE public.rag_content_chunks
  ADD COLUMN IF NOT EXISTS embedding_text        text,
  ADD COLUMN IF NOT EXISTS embedding_source_hash text,
  ADD COLUMN IF NOT EXISTS unit_type             text,
  ADD COLUMN IF NOT EXISTS heading_path          text,
  ADD COLUMN IF NOT EXISTS page_start            integer,
  ADD COLUMN IF NOT EXISTS page_end              integer,
  ADD COLUMN IF NOT EXISTS extraction_version    text;

-- unit_type CHECK. MUST permit NULL — every existing row has unit_type NULL
-- and a NOT-NULL-permitting variant would fail validation against all
-- ~16,006 of them. Validation of this constraint is effectively free because
-- the column was created all-NULL microseconds ago.
DO $chk_rag_unit_type$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_rag_unit_type'
       AND pg_class.relname = 'rag_content_chunks'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.rag_content_chunks
      ADD CONSTRAINT chk_rag_unit_type
      CHECK (unit_type IS NULL OR unit_type = ANY (ARRAY[
        'concept_explanation'::text,
        'definition'::text,
        'worked_example'::text,
        'qa_pair'::text,
        'mcq'::text,
        'diagram_caption'::text,
        'table'::text
      ]));
  END IF;
END $chk_rag_unit_type$;

-- Curated-lookup partial index. The WHERE clause excludes source='ncert_2025',
-- so this index contains ZERO entries for the existing corpus — it costs
-- essentially nothing today and grows only with curated content.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_curated_lookup
  ON public.rag_content_chunks (source, grade_short, subject_code, unit_type)
  WHERE source <> 'ncert_2025' AND is_active = true;

COMMENT ON COLUMN public.rag_content_chunks.embedding_text IS
  'Curated-corpus Phase 0 (2026-08-16): the short metadata-prefixed composite string that is actually sent to the embedding model, e.g. ''Board: CBSE / Grade: 10 / Subject: science / Chapter 6 > 6.2 Respiration — <chunk text>''. Distinct from chunk_text, which is the verbatim source text. NOT indexed by the FTS trigger (trg_rag_search_vector fires on chunk_text only) — see this migration''s header note (d) for why putting these prefixes into every tsvector would skew ts_rank corpus-wide. NULL on all pre-existing NCERT rows.';

COMMENT ON COLUMN public.rag_content_chunks.embedding_source_hash IS
  'Curated-corpus Phase 0 (2026-08-16): SHA-256 (lowercase hex) of embedding_text. Drives re-embed detection — if a recomputed embedding_text hashes differently from the stored value, the row''s vector is stale and must be regenerated. Lets re-ingestion skip unchanged chunks instead of re-paying for every embedding. NULL on all pre-existing NCERT rows.';

COMMENT ON COLUMN public.rag_content_chunks.unit_type IS
  'Curated-corpus Phase 0 (2026-08-16): FINE-grained taxonomy of what this chunk is. One of concept_explanation, definition, worked_example, qa_pair, mcq, diagram_caption, table; or NULL. Constrained by chk_rag_unit_type. This is an ADDITIONAL axis, not a replacement for content_type — content_type keeps its contracted 3 values (content/diagram/qa) and every unit_type maps DOWN onto one of them (mapping table in this migration''s header, note (a)). NULL on all pre-existing NCERT rows.';

COMMENT ON COLUMN public.rag_content_chunks.heading_path IS
  'Curated-corpus Phase 0 (2026-08-16): breadcrumb of the source document''s heading hierarchy for this chunk, e.g. ''Chapter 6 > 6.2 Respiration > Anaerobic''. Used to build embedding_text and to give retrieval results human-readable provenance. NULL on all pre-existing NCERT rows.';

COMMENT ON COLUMN public.rag_content_chunks.page_start IS
  'Curated-corpus Phase 0 (2026-08-16): 1-based first page of the source PDF this chunk was extracted from. Distinct from the older single-valued page_number column, which this does NOT replace. NULL on all pre-existing NCERT rows.';

COMMENT ON COLUMN public.rag_content_chunks.page_end IS
  'Curated-corpus Phase 0 (2026-08-16): 1-based last page of the source PDF this chunk was extracted from (equal to page_start for a single-page chunk). NULL on all pre-existing NCERT rows.';

COMMENT ON COLUMN public.rag_content_chunks.extraction_version IS
  'Curated-corpus Phase 0 (2026-08-16): semver-tagged identifier of the extraction pipeline that produced this chunk, e.g. ''pdf_ingest/1.0.0''. Makes a pipeline-version-scoped re-extraction targetable (WHERE extraction_version = ''pdf_ingest/1.0.0'') instead of requiring a full corpus rebuild. NULL on all pre-existing NCERT rows.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. public.rag_content_sources — the RIGHTS control
-- ═══════════════════════════════════════════════════════════════════════
-- This is the copyright gate and it is enforced HERE, in SQL, not only in the
-- ingestion script. A script-only check is one refactor away from being
-- bypassed; a column default is not.
--
-- DEFAULT 'restricted' means the SAFE state is the state you get by omission.
-- A source whose rights have never been explicitly determined can never
-- accidentally produce live student-facing content, because nothing had to be
-- remembered for it to be blocked.

ALTER TABLE public.rag_content_sources
  ADD COLUMN IF NOT EXISTS rights_status text NOT NULL DEFAULT 'restricted',
  ADD COLUMN IF NOT EXISTS rights_notes  text;

DO $chk_rag_sources_rights_status$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_rag_sources_rights_status'
       AND pg_class.relname = 'rag_content_sources'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.rag_content_sources
      ADD CONSTRAINT chk_rag_sources_rights_status
      CHECK (rights_status = ANY (ARRAY[
        'public_domain'::text,
        'ncert_open'::text,
        'licensed'::text,
        'permission_pending'::text,
        'restricted'::text
      ]));
  END IF;
END $chk_rag_sources_rights_status$;

COMMENT ON COLUMN public.rag_content_sources.rights_status IS
  'Curated-corpus Phase 3 (2026-08-16): COPYRIGHT CONTROL. Explicit rights determination for this source. One of: public_domain (out of copyright / CC0), ncert_open (NCERT material under its open terms), licensed (we hold a written licence — record it in rights_notes), permission_pending (request sent, NOT yet granted), restricted (no rights, or no determination made). NOT NULL DEFAULT ''restricted'' so the BLOCKED state is what you get by omission — a source with no explicit determination must never be able to produce live content. Only public_domain / ncert_open / licensed may be served to students; permission_pending and restricted must be treated as unusable by every consumer.';

COMMENT ON COLUMN public.rag_content_sources.rights_notes IS
  'Curated-corpus Phase 3 (2026-08-16): free-text evidence backing rights_status — licence identifier and expiry, the permission-request thread, the publisher contact, or the reason a source is restricted. Required in practice for rights_status = ''licensed'' or ''permission_pending''; not SQL-enforced because the evidence format varies per publisher.';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. public.rag_content_documents — storage + extraction + classification
-- ═══════════════════════════════════════════════════════════════════════
-- Adopting empty scaffolding that has existed since the baseline
-- (baseline_from_prod.sql:12973) and is referenced nowhere but the generated
-- types and one cascade test. The existing wiring is already correct and is
-- REUSED, not rebuilt:
--   - rag_content_chunks.document_id -> documents(id) ON DELETE CASCADE
--     (baseline:19337) — deleting a document removes its chunks.
--   - rag_content_chunks.source_id   -> sources(id)  ON DELETE SET NULL
--     (baseline:19341).
--   - rag_content_documents.source_id -> sources(id) ON DELETE CASCADE
--     (baseline:19345).
--   - approval_status text DEFAULT 'pending' NOT NULL already exists — REUSED,
--     not duplicated.
-- approved_by / approved_at are added because they do NOT exist here (they
-- exist on rag_content_sources only) — see the CORRECTION note in the header.

ALTER TABLE public.rag_content_documents
  ADD COLUMN IF NOT EXISTS storage_bucket     text,
  ADD COLUMN IF NOT EXISTS storage_path       text,
  ADD COLUMN IF NOT EXISTS file_sha256        text,
  ADD COLUMN IF NOT EXISTS page_count         integer,
  ADD COLUMN IF NOT EXISTS extraction_status  text,
  ADD COLUMN IF NOT EXISTS extraction_version text,
  ADD COLUMN IF NOT EXISTS needs_review       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS language           text,
  ADD COLUMN IF NOT EXISTS grade_short        text,
  ADD COLUMN IF NOT EXISTS subject_code       text,
  ADD COLUMN IF NOT EXISTS approved_by        uuid,
  ADD COLUMN IF NOT EXISTS approved_at        timestamp with time zone;

DO $chk_rag_docs_extraction_status$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_rag_docs_extraction_status'
       AND pg_class.relname = 'rag_content_documents'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.rag_content_documents
      ADD CONSTRAINT chk_rag_docs_extraction_status
      CHECK (extraction_status IS NULL OR extraction_status = ANY (ARRAY[
        'pending'::text,
        'extracted'::text,
        'failed'::text,
        'scanned'::text
      ]));
  END IF;
END $chk_rag_docs_extraction_status$;

-- P5: grades are STRINGS '6'..'12', never integers. This mirrors the existing
-- rag_chunks_valid_grade constraint on rag_content_chunks (baseline:10174) so
-- the two tables cannot disagree about what a grade is. NULL-permitting: a
-- document may legitimately span grades or be unclassified pending review.
DO $chk_rag_docs_grade_short$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_rag_docs_grade_short'
       AND pg_class.relname = 'rag_content_documents'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.rag_content_documents
      ADD CONSTRAINT chk_rag_docs_grade_short
      CHECK (grade_short IS NULL OR grade_short = ANY (ARRAY[
        '6'::text, '7'::text, '8'::text, '9'::text,
        '10'::text, '11'::text, '12'::text
      ]));
  END IF;
END $chk_rag_docs_grade_short$;

-- file_sha256 format lock. NOT in the original spec — added by architect
-- because the UNIQUE dedupe index below is only sound if the digest has ONE
-- canonical spelling. Without this, 'ABC…' and 'abc…' are distinct index keys
-- and a re-upload of a byte-identical PDF silently creates a duplicate
-- document row, which is exactly the failure the dedupe index exists to stop.
-- CONTRACT FOR THE INGESTOR: 64 LOWERCASE hex characters, no '0x' prefix, no
-- whitespace. In Python: hashlib.sha256(b).hexdigest() already satisfies this.
-- NULL-permitting so non-PDF / legacy document rows remain valid.
DO $chk_rag_docs_sha256_format$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_rag_docs_sha256_format'
       AND pg_class.relname = 'rag_content_documents'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.rag_content_documents
      ADD CONSTRAINT chk_rag_docs_sha256_format
      CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END $chk_rag_docs_sha256_format$;

-- Upload dedupe. Partial (WHERE file_sha256 IS NOT NULL) so the index carries
-- no entries for legacy/non-file document rows. Content-addressed upload
-- becomes a genuine no-op: the second attempt at a byte-identical PDF hits
-- this index and can be resolved with ON CONFLICT instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS rag_content_documents_file_sha256_uq
  ON public.rag_content_documents (file_sha256)
  WHERE file_sha256 IS NOT NULL;

-- Path resolution for the signed-URL-minting API route (bucket is private —
-- see 20260816000001). Partial: only rows that actually have a stored object.
CREATE INDEX IF NOT EXISTS idx_rag_docs_storage_path
  ON public.rag_content_documents (storage_bucket, storage_path)
  WHERE storage_path IS NOT NULL;

-- Extraction work queue. Partial so it only holds rows still needing work.
CREATE INDEX IF NOT EXISTS idx_rag_docs_extraction_queue
  ON public.rag_content_documents (extraction_status)
  WHERE extraction_status IN ('pending', 'failed');

COMMENT ON COLUMN public.rag_content_documents.storage_bucket IS
  'Curated-corpus Phase 1 (2026-08-16): Supabase Storage bucket holding this document''s source file. ''learning-sources'' for operator-curated PDFs (created PRIVATE by migration 20260816000001). Stored explicitly rather than assumed so a future second bucket does not require a backfill.';

COMMENT ON COLUMN public.rag_content_documents.storage_path IS
  'Curated-corpus Phase 1 (2026-08-16): object key within storage_bucket, following the content-addressed convention {board}/{grade}/{subject_code}/{sha256_16}/source.pdf (siblings: extract.json, assets/page_{nnnn}_image_{nnn}.png). grade is a STRING ''6''..''12'' per P5. The bucket is PRIVATE — never build a /storage/v1/object/public/ URL from this value; mint a short-lived signed URL server-side instead.';

COMMENT ON COLUMN public.rag_content_documents.file_sha256 IS
  'Curated-corpus Phase 1 (2026-08-16): SHA-256 of the ORIGINAL uploaded file bytes, as 64 LOWERCASE hex chars (enforced by chk_rag_docs_sha256_format). Uniquely indexed by rag_content_documents_file_sha256_uq for upload dedupe — re-uploading a byte-identical PDF is a no-op. The first 16 chars form the {sha256_16} segment of storage_path.';

COMMENT ON COLUMN public.rag_content_documents.page_count IS
  'Curated-corpus Phase 1 (2026-08-16): total page count of the source PDF. Sanity-checks extraction coverage — chunk page_start/page_end values must fall within 1..page_count.';

COMMENT ON COLUMN public.rag_content_documents.extraction_status IS
  'Curated-corpus Phase 1 (2026-08-16): pipeline state. pending = uploaded, not yet processed. extracted = text/units successfully produced. failed = extraction errored (details in rag_ingestion_failures). scanned = the PDF is an image-only scan with no extractable text layer, so it needs OCR before it can be chunked — deliberately a distinct terminal state from ''failed'' because the remedy is different. Constrained by chk_rag_docs_extraction_status. NULL for legacy rows.';

COMMENT ON COLUMN public.rag_content_documents.extraction_version IS
  'Curated-corpus Phase 1 (2026-08-16): semver-tagged identifier of the extraction pipeline that processed this document, e.g. ''pdf_ingest/1.0.0''. Matches rag_content_chunks.extraction_version on the chunks derived from it, so a pipeline-version-scoped re-extraction is targetable.';

COMMENT ON COLUMN public.rag_content_documents.needs_review IS
  'Curated-corpus Phase 3 (2026-08-16): human-review gate. NOT NULL DEFAULT true so the safe state (unreviewed) is what a row gets by omission — a document can only become review-clear by an explicit act. Distinct from approval_status: needs_review is the CONTENT-QUALITY check (did extraction produce sane text?), approval_status is the EDITORIAL sign-off. Both must clear before content is served.';

COMMENT ON COLUMN public.rag_content_documents.language IS
  'Curated-corpus Phase 1 (2026-08-16): BCP-47-ish language tag of the document body, matching the existing rag_content_chunks.language convention (''en'', ''hi''). Note P7 governs UI text, not corpus content — this column records what language the SOURCE is in.';

COMMENT ON COLUMN public.rag_content_documents.grade_short IS
  'Curated-corpus Phase 1 (2026-08-16): CBSE grade as a STRING ''6''..''12'' (P5 — never an integer). Constrained by chk_rag_docs_grade_short, mirroring rag_chunks_valid_grade on rag_content_chunks. NULL when the document spans grades or is unclassified pending review.';

COMMENT ON COLUMN public.rag_content_documents.subject_code IS
  'Curated-corpus Phase 1 (2026-08-16): subject code matching the rag_content_chunks.subject_code / cbse_syllabus.subject_code vocabulary (e.g. ''science'', ''maths''). Deliberately unconstrained by CHECK so a new subject does not require a migration; join integrity is the ingestor''s responsibility.';

COMMENT ON COLUMN public.rag_content_documents.approved_by IS
  'Curated-corpus Phase 3 (2026-08-16): auth user id of the reviewer who set approval_status to its current value. Added because it did NOT already exist on this table (it exists on rag_content_sources only) — an approval with no recorded approver is not auditable. No FK to auth.users, matching the rag_content_sources.approved_by convention.';

COMMENT ON COLUMN public.rag_content_documents.approved_at IS
  'Curated-corpus Phase 3 (2026-08-16): timestamp of the approval_status transition recorded by approved_by. Added alongside approved_by for the same auditability reason.';

-- ═══════════════════════════════════════════════════════════════════════
-- 4. RLS ASSERTION (P8)
-- ═══════════════════════════════════════════════════════════════════════
-- This migration creates NO new table, so P8's "RLS in the same migration"
-- requirement is satisfied by inheritance. But inheritance is an assumption,
-- and an assumption that silently stops being true is exactly how a corpus
-- leaks. So we ASSERT it.
--
-- Expected posture for all three tables (established by
-- 20260516020000_tighten_rls_policy_always_true.sql and
-- 20260728090000_lockdown_anon_readable_public_tables.sql):
--   - relrowsecurity = true
--   - the permissive SELECT policies (rag_*_read, USING (true), TO public)
--     were DROPPED by the 2026-07-28 lockdown
--   - the remaining rag_*_write policies are FOR INSERT TO service_role
--     WITH CHECK (true) — that is INTENTIONAL and not a finding: service_role
--     bypasses RLS anyway, and the role scoping is what removes the anon
--     vector. We therefore flag `USING (true)` only when it is NOT scoped to
--     service_role.
--
-- This block RAISEs WARNING (not EXCEPTION) so a posture regression is loud in
-- the deploy log without failing an otherwise-correct additive migration.
-- The hard gate belongs in CI (.github/scripts/assert-db-security-invariants.sh).

DO $assert_rls$
DECLARE
  v_tbl        text;
  v_tables     text[] := ARRAY[
                   'rag_content_chunks',
                   'rag_content_documents',
                   'rag_content_sources'
                 ];
  v_rls        boolean;
  v_findings   int := 0;
  rec          record;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    SELECT c.relrowsecurity INTO v_rls
      FROM pg_class c
     WHERE c.relname = v_tbl
       AND c.relnamespace = 'public'::regnamespace;

    IF v_rls IS NULL THEN
      RAISE WARNING 'curated-corpus P8 ASSERT: table public.% NOT FOUND', v_tbl;
      v_findings := v_findings + 1;
    ELSIF v_rls IS NOT TRUE THEN
      RAISE WARNING 'curated-corpus P8 ASSERT: RLS is DISABLED on public.% — corpus is exposed. Run: ALTER TABLE public.% ENABLE ROW LEVEL SECURITY;', v_tbl, v_tbl;
      v_findings := v_findings + 1;
    ELSE
      RAISE NOTICE 'curated-corpus P8 ASSERT: RLS enabled on public.% : OK', v_tbl;
    END IF;
  END LOOP;

  -- Any USING (true) policy that is NOT scoped to service_role is an open door.
  FOR rec IN
    SELECT p.tablename, p.policyname, p.cmd, p.roles::text[] AS roles
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = ANY (v_tables)
       AND COALESCE(p.qual, '') = 'true'
       AND NOT (p.roles::text[] <@ ARRAY['service_role'])
  LOOP
    RAISE WARNING 'curated-corpus P8 ASSERT: policy %.% (cmd=%, roles=%) is USING (true) and NOT service_role-scoped — must remain service-role-only',
      rec.tablename, rec.policyname, rec.cmd, rec.roles;
    v_findings := v_findings + 1;
  END LOOP;

  -- Any policy reachable by anon / authenticated / public at all.
  FOR rec IN
    SELECT p.tablename, p.policyname, p.cmd, p.roles::text[] AS roles
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = ANY (v_tables)
       AND (p.roles::text[] && ARRAY['anon', 'authenticated', 'public'])
  LOOP
    RAISE WARNING 'curated-corpus P8 ASSERT: policy %.% (cmd=%, roles=%) is reachable by a non-service role — these three tables must stay service-role-only',
      rec.tablename, rec.policyname, rec.cmd, rec.roles;
    v_findings := v_findings + 1;
  END LOOP;

  -- Inventory, so the deploy log records the exact posture that was observed.
  FOR rec IN
    SELECT p.tablename, p.policyname, p.cmd, p.roles::text[] AS roles
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = ANY (v_tables)
     ORDER BY p.tablename, p.policyname
  LOOP
    RAISE NOTICE 'curated-corpus P8 ASSERT: existing policy %.% cmd=% roles=%',
      rec.tablename, rec.policyname, rec.cmd, rec.roles;
  END LOOP;

  IF v_findings = 0 THEN
    RAISE NOTICE 'curated-corpus P8 ASSERT: all 3 rag_content_* tables service-role-only with RLS on — OK';
  ELSE
    RAISE WARNING 'curated-corpus P8 ASSERT: % RLS finding(s) — see warnings above', v_findings;
  END IF;
END $assert_rls$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Verification — self-documents whether the migration landed
-- ═══════════════════════════════════════════════════════════════════════

DO $verify_curated_corpus$
DECLARE
  v_chunk_cols   int;
  v_source_cols  int;
  v_doc_cols     int;
  v_constraints  int;
  v_indexes      int;
  v_ncert_source_ok boolean;
  v_content_type_untouched boolean;
  v_question_type_untouched boolean;
  v_trigger_ok   boolean;
  v_total_chunks bigint;
  v_curated_chunks bigint;
BEGIN
  SELECT count(*) INTO v_chunk_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'rag_content_chunks'
     AND column_name IN ('embedding_text','embedding_source_hash','unit_type',
                         'heading_path','page_start','page_end','extraction_version');

  SELECT count(*) INTO v_source_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'rag_content_sources'
     AND column_name IN ('rights_status','rights_notes');

  SELECT count(*) INTO v_doc_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'rag_content_documents'
     AND column_name IN ('storage_bucket','storage_path','file_sha256','page_count',
                         'extraction_status','extraction_version','needs_review',
                         'language','grade_short','subject_code','approved_by','approved_at');

  SELECT count(*) INTO v_constraints
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relnamespace = 'public'::regnamespace
     AND c.conname IN ('chk_rag_unit_type','chk_rag_sources_rights_status',
                       'chk_rag_docs_extraction_status','chk_rag_docs_grade_short',
                       'chk_rag_docs_sha256_format');

  SELECT count(*) INTO v_indexes
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('idx_rag_chunks_curated_lookup','rag_content_documents_file_sha256_uq',
                       'idx_rag_docs_storage_path','idx_rag_docs_extraction_queue');

  -- NEGATIVE assertions: prove we did NOT touch what we said we would not.
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'rag_chunks_source_ncert_only'
       AND t.relname = 'rag_content_chunks'
       AND t.relnamespace = 'public'::regnamespace
       AND pg_get_constraintdef(c.oid) LIKE '%curated%'
  ) INTO v_ncert_source_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'chk_rag_content_type'
       AND t.relname = 'rag_content_chunks'
       AND t.relnamespace = 'public'::regnamespace
       AND pg_get_constraintdef(c.oid) LIKE '%diagram%'
       AND pg_get_constraintdef(c.oid) NOT LIKE '%concept_explanation%'
  ) INTO v_content_type_untouched;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'chk_rag_question_type'
       AND t.relname = 'rag_content_chunks'
       AND t.relnamespace = 'public'::regnamespace
       AND pg_get_constraintdef(c.oid) NOT LIKE '%qa_pair%'
  ) INTO v_question_type_untouched;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class t ON t.oid = tg.tgrelid
     WHERE tg.tgname = 'trg_rag_search_vector'
       AND t.relname = 'rag_content_chunks'
       AND t.relnamespace = 'public'::regnamespace
       AND NOT tg.tgisinternal
  ) INTO v_trigger_ok;

  SELECT count(*) INTO v_total_chunks FROM public.rag_content_chunks;
  SELECT count(*) INTO v_curated_chunks
    FROM public.rag_content_chunks WHERE source <> 'ncert_2025';

  RAISE NOTICE 'curated-corpus: rag_content_chunks new columns (%/7)', v_chunk_cols;
  RAISE NOTICE 'curated-corpus: rag_content_sources new columns (%/2)', v_source_cols;
  RAISE NOTICE 'curated-corpus: rag_content_documents new columns (%/12)', v_doc_cols;
  RAISE NOTICE 'curated-corpus: new CHECK constraints (%/5)', v_constraints;
  RAISE NOTICE 'curated-corpus: new indexes (%/4)', v_indexes;
  RAISE NOTICE 'curated-corpus: rag_chunks_source_ncert_only already allows ''curated'' (no change made): %', v_ncert_source_ok;
  RAISE NOTICE 'curated-corpus: chk_rag_content_type left UNWIDENED: %', v_content_type_untouched;
  RAISE NOTICE 'curated-corpus: chk_rag_question_type left UNWIDENED: %', v_question_type_untouched;
  RAISE NOTICE 'curated-corpus: trg_rag_search_vector still present/unmodified: %', v_trigger_ok;
  RAISE NOTICE 'curated-corpus: rag_content_chunks total rows=% (non-ncert_2025=%)', v_total_chunks, v_curated_chunks;

  IF v_chunk_cols < 7 OR v_source_cols < 2 OR v_doc_cols < 12
     OR v_constraints < 5 OR v_indexes < 4 THEN
    RAISE WARNING 'curated-corpus: migration did NOT land cleanly — see counts above';
  ELSIF NOT v_ncert_source_ok THEN
    RAISE WARNING 'curated-corpus: rag_chunks_source_ncert_only does NOT allow ''curated'' — 20260520000004 may not have been applied on this environment. Curated chunk INSERTs will fail until it is.';
  ELSIF NOT v_content_type_untouched OR NOT v_question_type_untouched OR NOT v_trigger_ok THEN
    RAISE WARNING 'curated-corpus: a DO-NOT-TOUCH invariant was violated (content_type/question_type widened, or search_vector trigger missing)';
  ELSE
    RAISE NOTICE 'curated-corpus: MIGRATION COMPLETE — curated-PDF ingestion schema ready (retrieval RPCs unchanged, owned by ai-engineer in a later phase)';
  END IF;
END $verify_curated_corpus$;

COMMIT;
