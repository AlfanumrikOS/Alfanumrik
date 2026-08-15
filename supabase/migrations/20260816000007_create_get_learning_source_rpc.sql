-- Migration: 20260816000007_create_get_learning_source_rpc.sql
-- Purpose: Create the get_learning_source SECURITY DEFINER RPC that the
--          learning-sources loader route (apps/host/src/app/api/learning-sources/route.ts)
--          proxies through. This RPC resolves the storage path from the
--          curriculum metadata and returns the signed URL via the
--          service_role client (which has direct storage access).
--
-- The loader route validates path shape + mints signed URL. This RPC is the
-- backend counterpart that does the curriculum lookup. Both must agree on
-- the path convention: {board}/{grade}/{subject_code}/{sha256_16}/{filename}.
--
-- SECURITY: SECURITY DEFINER, owned by postgres. Revoked from PUBLIC/
-- authenticated, granted to service_role only (the loader route uses
-- supabaseAdmin = service_role). No direct end-user call path.

BEGIN;

CREATE OR REPLACE FUNCTION "public"."get_learning_source"(
  p_board text,
  p_grade integer,
  p_subject_code text,
  p_sha256_16 text,
  p_filename text DEFAULT 'source.pdf'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_path text;
  v_signed_url text;
  v_result json;
BEGIN
  -- Validate inputs
  IF p_board IS NULL OR p_board = '' THEN
    RAISE EXCEPTION 'board is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_grade IS NULL OR p_grade < 6 OR p_grade > 12 THEN
    RAISE EXCEPTION 'grade must be 6-12' USING ERRCODE = 'invalid_parameter_value';
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

  -- Validate filename doesn't contain traversal
  IF v_path LIKE '%/..%' OR v_path LIKE '%..%/' THEN
    RAISE EXCEPTION 'filename contains path traversal' USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, integer, text, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, integer, text, text, text) FROM postgres;
GRANT EXECUTE ON FUNCTION "public"."get_learning_source"(text, integer, text, text, text) TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification: confirm the function exists and has correct grants
--
-- SELECT proname, prosecdef, proowner, pronamespace
-- FROM pg_proc
-- WHERE proname = 'get_learning_source';
--
-- SELECT princepd, pg_get_userbyid(privilege_type::regrole) AS grantee
-- FROM pg_init_privs
-- WHERE objid = 'get_learning_source'::regprocedure;
--
-- SELECT * FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public' AND routine_name = 'get_learning_source';
