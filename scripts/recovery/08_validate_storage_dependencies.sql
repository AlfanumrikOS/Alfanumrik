-- scripts/recovery/08_validate_storage_dependencies.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks that storage buckets referenced by migrations
-- exist and that any storage.objects RLS policies reference the correct bucket
-- names. Misconfigured storage would silently fail invoice PDF generation or
-- signed contract downloads.
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 8 — run after repair migrations have been applied.
-- DEPENDENCIES: storage schema must be accessible (service_role required).
-- IDEMPOTENCY: N/A — read-only.

-- ============================================================================
-- 1. Storage buckets created by migrations
-- ============================================================================

SELECT
  id          AS bucket_id,
  name        AS bucket_name,
  public      AS is_public,
  created_at
FROM storage.buckets
WHERE id IN (
  'payment-receipts',    -- 20260507140000_payment_reconciliation_queue
  'school-invoices',     -- 20260507130001_extend_school_invoices_for_gst
  'school-contracts',    -- 20260507150000_school_contracts
  'avatars',             -- from baseline (student profile photos)
  'question-images'      -- from baseline (question bank images)
)
ORDER BY id;

-- Expected: payment-receipts, school-invoices, school-contracts all present
-- and NOT public (is_public = false). Private buckets require signed URLs.

-- ============================================================================
-- 2. All storage buckets (comprehensive list)
-- ============================================================================

SELECT
  id,
  name,
  public AS is_public,
  created_at,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
ORDER BY id;

-- Review: confirm no unexpected public buckets. The three school/payment buckets
-- MUST be private (is_public = false). A public bucket would expose confidential
-- financial documents to unauthenticated requests.

-- ============================================================================
-- 3. RLS policies on storage.objects — bucket name references
-- ============================================================================

SELECT
  pol.polname AS policy_name,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_clause,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_clause
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'storage'
  AND c.relname = 'objects'
ORDER BY pol.polname;

-- Review: confirm any bucket-name references in the policies match the actual
-- bucket IDs listed in query 2. A policy referencing 'school_invoices' (underscore)
-- when the bucket is named 'school-invoices' (hyphen) would silently grant no access.

-- ============================================================================
-- 4. Functions that reference storage schema
-- ============================================================================

SELECT
  p.proname      AS function_name,
  n.nspname      AS schema_name,
  CASE WHEN pg_get_functiondef(p.oid) ILIKE '%storage.%' THEN 'YES' ELSE 'no' END AS refs_storage
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%storage.%'
ORDER BY p.proname;

-- Expected: 0-5 functions. If functions reference storage.objects or
-- storage.buckets directly (rather than via signed URLs), audit them for
-- correctness.
