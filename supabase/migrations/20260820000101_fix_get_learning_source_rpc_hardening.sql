-- Migration: 20260820000101_fix_get_learning_source_rpc_hardening.sql
-- Purpose: Harden `public.get_learning_source` (created by
--          20260816000007_create_get_learning_source_rpc.sql) — P0-1 fix,
--          comprehensive code review 2026-08-20.
--
-- ─── Why a NEW migration instead of editing 20260816000007 ────────────────────
-- Per this repo's own convention for a migration that may already be applied
-- on some environment (evidenced by the 20260815000005 -> 20260815000006
-- history: never hand-edit a possibly-applied migration file — ship a new
-- corrective one instead), 20260816000007 is left untouched. This migration
-- DROPs the old signature and CREATEs the corrected one in its place. A plain
-- `CREATE OR REPLACE FUNCTION` cannot be used here because `p_grade` changes
-- type (integer -> text) — Postgres rejects a parameter-type change under
-- CREATE OR REPLACE ("cannot change data type of existing parameter").
--
-- ─── Is this function actually called anywhere? NO — still dead code ─────────
-- Grep confirms nothing calls `get_learning_source` (not the learning-sources
-- loader route, not any other route, not any other RPC). It is still worth
-- fixing for defense-in-depth: it is SECURITY DEFINER and, once wired up,
-- callable by service_role. Hardening it now means whoever wires it up later
-- inherits a safe function instead of a latent P0.
--
-- ─── The three fixes ────────────────────────────────────────────────────────
--   1. P5 (grades are strings): `p_grade` changes from `integer` to `text`,
--      with validation against the canonical CBSE grade set instead of a
--      numeric range check.
--   2. `SET search_path = ''` hardening. The original had NO search_path pin
--      at all on a SECURITY DEFINER function — the exact class of hole a
--      malicious `search_path` could exploit to shadow an unqualified
--      identifier with an attacker-controlled object. `pg_catalog` stays
--      implicitly available in PG15+ even with an empty search_path, so the
--      built-ins this function calls (format(), length(), left(), coalesce(),
--      json_build_object()) still resolve with no other change required.
--   3. Path-traversal guard fix. The original guard was
--        v_path LIKE '%/..%' OR v_path LIKE '%..%/'
--      — the second arm is a typo for '%../%\'' (it only matches paths
--      ENDING in '/', so a LEADING '..' segment, e.g. '../secret/x', passes
--      straight through both arms). Replaced with a robust per-segment check:
--      split v_path on '/' and reject if any segment is '..' or '' (the
--      latter also rejects double-slashes), which catches leading, trailing,
--      and embedded traversal in one pass instead of pattern-guessing.
--
-- SECURITY: SECURITY DEFINER, owned by postgres. Revoked from PUBLIC/
-- authenticated, granted to service_role only (the loader route uses
-- supabaseAdmin = service_role). No direct end-user call path. Unchanged from
-- 20260816000007.

BEGIN;

DROP FUNCTION IF EXISTS "public"."get_learning_source"(text, integer, text, text, text);

CREATE FUNCTION "public"."get_learning_source"(
  p_board text,
  p_grade text,
  p_subject_code text,
  p_sha256_16 text,
  p_filename text DEFAULT 'source.pdf'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path text;
  v_segments text[];
  v_segment text;
  v_signed_url text;
  v_result json;
BEGIN
  -- Validate inputs
  IF p_board IS NULL OR p_board = '' THEN
    RAISE EXCEPTION 'board is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- P5: grades are strings ('6'..'12'), never integers.
  -- NOTE: this must be `NOT (p_grade = ANY (...))`, not `p_grade <> ANY (...)`.
  -- `x <> ANY(array)` means "x differs from AT LEAST ONE element" — true for
  -- almost any x against a multi-element array, so it would reject every
  -- grade including valid ones. `NOT (x = ANY(array))` correctly means
  -- "x matches NONE of the elements" (verified against a live Postgres
  -- instance during review — the naive `<> ANY` form rejected all input).
  IF p_grade IS NULL OR NOT (p_grade = ANY (ARRAY['6','7','8','9','10','11','12'])) THEN
    RAISE EXCEPTION 'grade must be one of 6..12 (as a string)' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_subject_code IS NULL OR p_subject_code = '' THEN
    RAISE EXCEPTION 'subject_code is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_sha256_16 IS NULL OR p_sha256_16 = '' OR length(p_sha256_16) < 16 THEN
    RAISE EXCEPTION 'sha256_16 must be at least 16 hex characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Build the storage path
  v_path := format('%s/%s/%s/%s/%s',
    p_board,
    p_grade,
    p_subject_code,
    left(p_sha256_16, 16),
    coalesce(p_filename, 'source.pdf')
  );

  -- Path-traversal guard: reject if ANY '/'-delimited segment is '..' or ''
  -- (empty segments also reject leading '/', trailing '/', and embedded
  -- '//'). This replaces the previous fragile LIKE-pattern pair, whose
  -- second arm ('%..%/' ) only matched traversal segments that were followed
  -- by a '/' — so a LEADING '..' segment (e.g. '../secret/x') slipped past
  -- both arms undetected.
  v_segments := string_to_array(v_path, '/');
  FOREACH v_segment IN ARRAY v_segments LOOP
    IF v_segment = '..' OR v_segment = '' THEN
      RAISE EXCEPTION 'path contains traversal or malformed segments' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- Mint the signed URL via the service_role storage client.
  -- This requires the function to run as SECURITY DEFINER with
  -- the postgres role (which has storage.admin capability via
  -- the service_role grants on the bucket).
  --
  -- We call the Supabase storage API via the internal function
  -- that the loader route also uses. Since this runs as
  -- SECURITY DEFINER postgres, we can use the admin client.
  --
  -- For now, return the path — the actual signed URL minting
  -- happens in the loader route (Node.js) which has the
  -- Supabase JS client with createSignedUrl.
  --
  -- FUTURE: if we want this RPC to mint the signed URL directly,
  -- we'd need to call an internal storage API. Postgres can't
  -- call HTTPS endpoints without http_extension or similar.
  -- The loader route pattern (scan-solve/route.ts:273-284) shows
  -- the right approach: Node.js mints the URL using
  -- supabaseAdmin.storage.from(bucket).createSignedUrl().

  v_result := json_build_object(
    'path', v_path,
    'board', p_board,
    'grade', p_grade,
    'subject_code', p_subject_code,
    'sha256_16', left(p_sha256_16, 16),
    'filename', coalesce(p_filename, 'source.pdf'),
    'note', 'Signed URL must be minted by the loader route (Node.js) using supabaseAdmin.storage.from().createSignedUrl()'
  );

  RETURN v_result;
END;
$$;

-- Revoke from all non-service_role roles
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM postgres;
GRANT EXECUTE ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification: confirm the function exists with the new signature and grants
--
-- SELECT proname, prosecdef, proconfig, proowner, pronamespace
-- FROM pg_proc
-- WHERE proname = 'get_learning_source';
-- -- expect: prosecdef = true, proconfig contains 'search_path='
--
-- SELECT p.oid::regprocedure::text
-- FROM pg_proc p
-- WHERE p.proname = 'get_learning_source';
-- -- expect exactly one row: get_learning_source(text, text, text, text, text)
--
-- SELECT * FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public' AND routine_name = 'get_learning_source';
-- -- expect: grantee = service_role only
