-- Migration: 20260816000001_learning_sources_bucket.sql
-- Purpose:    Phase 1 of the curated-PDF learning-corpus program. Creates the
--             PRIVATE `learning-sources` storage bucket that holds operator-
--             uploaded source PDFs and their extraction artefacts.
--
-- Owner: architect (schema/storage/RLS).
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY PRIVATE, AND WHY NO storage.objects POLICIES
-- ─────────────────────────────────────────────────────────────────────────
-- This bucket holds third-party copyrighted PDFs whose rights status is
-- tracked in public.rag_content_sources.rights_status (added by the sibling
-- migration 20260816000002_curated_learning_corpus.sql, DEFAULT 'restricted').
-- A publicly-listable bucket would make that whole control cosmetic: anyone
-- who guessed a path could fetch the raw PDF regardless of what the database
-- said about its licensing.
--
-- We therefore create ZERO policies on storage.objects. That is not an
-- oversight — it is the documented house convention, established by
-- `supabase/migrations/20260507130001_extend_school_invoices_for_gst.sql:58`
-- for the `school-invoices` bucket:
--
--     "Storage RLS: we leave storage.objects scoped to service_role only and
--      route every read through [an API route] (which enforces
--      authorisation and mints a signed URL). Adding a [role] SELECT policy
--      here would require resolving [the tenant key] from the storage path,
--      which is brittle."
--
-- Same reasoning applies verbatim here. With no policy, RLS on
-- storage.objects denies anon and authenticated by default; only the service
-- role (which bypasses RLS) can read or write. Every read must go through a
-- server-side route that authorises the caller and mints a short-lived signed
-- URL. Do NOT "fix" the missing policies by adding a permissive one.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PATH CONVENTION (content-addressed)
-- ─────────────────────────────────────────────────────────────────────────
--   {board}/{grade}/{subject_code}/{sha256_16}/source.pdf
--   {board}/{grade}/{subject_code}/{sha256_16}/extract.json
--   {board}/{grade}/{subject_code}/{sha256_16}/assets/page_{nnnn}_image_{nnn}.{png|jpeg}
--
--   board        e.g. 'CBSE'
--   grade        STRING '6'..'12' (P5 — grades are never integers)
--   subject_code e.g. 'science', 'maths'
--   sha256_16    first 16 hex chars of the SHA-256 of the ORIGINAL PDF bytes.
--                Mirrored into rag_content_documents.file_sha256 (full 64-char
--                digest, UNIQUE-indexed) by the sibling migration.
--
-- Content-addressing means re-uploading a byte-identical PDF resolves to the
-- same prefix, so the upload is an idempotent no-op rather than a duplicate.
-- It also means a corrected/re-scanned PDF lands under a NEW prefix instead of
-- silently overwriting the artefacts that existing chunks were derived from.
--
-- file_size_limit 104857600 = 100 MiB. Largest NCERT-scale textbook PDFs
-- observed in the operator tooling are well under this; the cap exists to stop
-- an accidental multi-GB upload, not to be a tight fit.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ALLOWED MIME TYPES — RESOLVED: one bucket, widened allowlist
-- ─────────────────────────────────────────────────────────────────────────
-- Supabase enforces allowed_mime_types on EVERY upload, including service-role
-- uploads. A PDF-only allowlist would therefore reject `extract.json` and the
-- `assets/page_*` images that the path convention above places under the SAME
-- prefix as the PDF they were derived from. The allowlist is:
--
--     application/pdf    source.pdf
--     application/json   extract.json
--     image/png          assets/page_{nnnn}_image_{nnn}.png
--     image/jpeg         assets/page_{nnnn}_image_{nnn}.jpeg
--
-- image/jpeg is NOT speculative. The prior extraction run under
-- `tools/pdf-content-ingestor/data/assets/` emitted BOTH formats, interleaved
-- within the same document prefix (`page_0001_image_001.png` sits next to
-- `page_0002_image_001.jpeg`). Measured 2026-08-13: 2,979 .jpeg vs 1,914 .png,
-- and no other extension — so JPEG is the MAJORITY of extracted images and a
-- PNG-only allowlist would have rejected ~61% of them. The extractor picks the
-- format from the embedded image stream, so neither type can be assumed away.
--
-- A second private `learning-artifacts` bucket for the derived artefacts was
-- considered and REJECTED. Both buckets would be private with identical
-- service-role-only access, so splitting them buys zero security or rights
-- separation while doubling the plumbing: two bucket rows, two path
-- conventions, two signed-URL routes. Keeping the artefacts content-addressed
-- under the same {sha256_16} prefix as their source PDF is what makes
-- re-upload a no-op and makes "delete everything derived from this document" a
-- single prefix delete.
--
-- HONEST LIMITATION: widening the allowlist is bucket-wide, not path-scoped.
-- Nothing at the storage layer stops a caller from putting a JSON or PNG at
-- `{...}/source.pdf`, or an object anywhere outside the documented prefix
-- shape. Path discipline is enforced by the LOADER, not by the bucket. The
-- bucket's job here is only to (a) stay private and (b) refuse file types the
-- pipeline never produces (e.g. text/html, application/zip, executables).
--
-- Do NOT resolve any future mime-type friction by setting public = true.
--
-- ─────────────────────────────────────────────────────────────────────────
-- KNOWN RISK, DELIBERATELY OUT OF SCOPE: the `ncert-books` bucket is PUBLIC
-- ─────────────────────────────────────────────────────────────────────────
-- `supabase/migrations/_legacy/timestamped/20260403300000_embed_diagrams_in_rag.sql:540`
-- runs `UPDATE storage.buckets SET public = true WHERE id = 'ncert-books';`
-- That was deliberate, and it is load-bearing:
--   - supabase/functions/extract-diagrams/index.ts:111 and
--     supabase/functions/embed-diagrams/index.ts:68 both build URLs of the form
--     `{SUPABASE_URL}/storage/v1/object/public/ncert-books/{path}`
--   - Those URLs are PERSISTED into rag_content_chunks.media_url.
-- Flipping `ncert-books` to private would therefore not fail loudly — it would
-- silently 400 every already-persisted diagram URL across the live corpus.
-- Remediating that requires migrating persisted media_url values to a signed-
-- URL-minting route first. That is a separate, sequenced piece of work and is
-- EXPLICITLY NOT attempted here. This migration does not touch `ncert-books`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Idempotent: yes. ON CONFLICT (id) DO NOTHING, followed by a narrow UPDATE
-- that converges ONLY allowed_mime_types. The UPDATE exists because DO NOTHING
-- means a pre-existing bucket row — e.g. from an earlier partial run in a test
-- container that got the PDF-only allowlist — would otherwise never pick up the
-- widened list, and the JSON/image uploads would keep failing with no
-- indication that the migration had "already run".
--
-- The UPDATE is deliberately scoped to allowed_mime_types alone. It does NOT
-- re-assert public/false or file_size_limit, so an operator who intentionally
-- tunes file_size_limit in the dashboard is not silently reverted on the next
-- `db push`. See the verification block: it RAISEs a WARNING (not an error) if
-- the bucket is found public, so drift is visible in the migration log without
-- failing an unrelated deploy.
--
-- Rollback (manual, requires user approval — destroys uploaded objects):
--   Preconditions to verify FIRST:
--     a) SELECT count(*) FROM storage.objects WHERE bucket_id='learning-sources';
--        Must be 0, or you are about to delete operator-uploaded source PDFs.
--     b) SELECT count(*) FROM public.rag_content_documents
--         WHERE storage_bucket = 'learning-sources';
--        Must be 0, or document rows will point at a bucket that no longer
--        exists (the FK-less storage_path becomes a dangling reference).
--     c) SELECT count(*) FROM public.rag_content_chunks WHERE source <> 'ncert_2025';
--        Must be 0, or live retrieval content is derived from objects you are
--        about to delete and provenance becomes unauditable.
--   Then:
--     DELETE FROM storage.objects WHERE bucket_id = 'learning-sources';
--     DELETE FROM storage.buckets WHERE id = 'learning-sources';
--   There is no compensating migration for the deleted objects — the PDFs are
--   only recoverable from the operator's local `tools/` working copy.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. The bucket. PRIVATE (public = false) — see header.
-- ───────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'learning-sources',
  'learning-sources',
  false,
  104857600,
  ARRAY['application/pdf', 'application/json', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Converge the allowlist on a bucket row that already exists.
-- ON CONFLICT (id) DO NOTHING above means a row created by an earlier partial
-- run (PDF-only allowlist) would keep rejecting extract.json / assets uploads
-- forever, because `db push` would report this migration as applied. This
-- UPDATE is a no-op when the array already matches, and touches nothing else —
-- NOT public, NOT file_size_limit (see header on deliberate operator drift).

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['application/pdf', 'application/json', 'image/png', 'image/jpeg']
 WHERE id = 'learning-sources'
   AND allowed_mime_types IS DISTINCT FROM
       ARRAY['application/pdf', 'application/json', 'image/png', 'image/jpeg'];

-- ───────────────────────────────────────────────────────────────────────
-- 2. NO storage.objects policies. Intentional. See header.
--    With RLS enabled on storage.objects (Supabase default) and no policy
--    naming this bucket, anon and authenticated are denied everything here;
--    service_role bypasses RLS. Reads are minted as signed URLs by a
--    server-side route.
-- ───────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────
-- 3. Verification — self-documents in the migration log.
-- ───────────────────────────────────────────────────────────────────────

DO $verify_learning_sources_bucket$
DECLARE
  v_exists       boolean;
  v_public       boolean;
  v_limit        bigint;
  v_mimes        text[];
  v_policies     int;
  v_ncert_public boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'learning-sources')
    INTO v_exists;

  IF NOT v_exists THEN
    RAISE WARNING 'curated-corpus Phase 1: learning-sources bucket NOT present after migration';
  ELSE
    SELECT b.public, b.file_size_limit, b.allowed_mime_types
      INTO v_public, v_limit, v_mimes
      FROM storage.buckets b
     WHERE b.id = 'learning-sources';

    RAISE NOTICE 'curated-corpus Phase 1: learning-sources bucket present (public=%, file_size_limit=%, allowed_mime_types=%)',
      v_public, v_limit, v_mimes;

    IF v_public IS DISTINCT FROM false THEN
      RAISE WARNING 'curated-corpus Phase 1: learning-sources bucket is PUBLIC — copyright/rights control is bypassed. Set public=false.';
    END IF;

    -- The convergence UPDATE above runs in this same transaction, so a mismatch
    -- here means the UPDATE did not take (e.g. the column was altered
    -- out-of-band). extract.json / assets uploads would silently 400.
    IF NOT ('application/json' = ANY(COALESCE(v_mimes, ARRAY[]::text[]))
            AND 'image/png'  = ANY(COALESCE(v_mimes, ARRAY[]::text[]))
            AND 'image/jpeg' = ANY(COALESCE(v_mimes, ARRAY[]::text[]))) THEN
      RAISE WARNING 'curated-corpus Phase 1: learning-sources allowed_mime_types is missing a derived-artefact type (have %). extract.json and/or assets/page_* uploads will be REJECTED.', v_mimes;
    END IF;
  END IF;

  -- Assert we did not accidentally create (or inherit) a permissive
  -- storage.objects policy scoped to this bucket.
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename  = 'objects'
     AND (COALESCE(qual, '') LIKE '%learning-sources%'
          OR COALESCE(with_check, '') LIKE '%learning-sources%');

  IF v_policies > 0 THEN
    RAISE WARNING 'curated-corpus Phase 1: % storage.objects policy/policies reference learning-sources. Expected 0 (service_role-only convention).', v_policies;
  ELSE
    RAISE NOTICE 'curated-corpus Phase 1: 0 storage.objects policies reference learning-sources (service_role-only, as intended)';
  END IF;

  -- Explicitly report ncert-books so the log records that we left it alone.
  -- Expected value is TRUE. That is deliberate and load-bearing (see header) —
  -- it is NOT a finding, and it must not be "fixed" here.
  SELECT b.public INTO v_ncert_public
    FROM storage.buckets b
   WHERE b.id = 'ncert-books';

  RAISE NOTICE 'curated-corpus Phase 1: ncert-books public flag (UNCHANGED by this migration, expected true) = %',
    v_ncert_public;
END $verify_learning_sources_bucket$;

COMMIT;
