import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

/**
 * GET /api/learning-sources?board=&grade=&subject_code=&sha256=&type=&filename=
 *
 * Mints a short-lived signed URL for a curated-corpus asset in the
 * `learning-sources` private storage bucket.
 *
 * Path convention (enforced by this route, NOT by the bucket — see
 * supabase/migrations/20260816000001_learning_sources_bucket.sql:88-94):
 *   {board}/{grade}/{subject_code}/{sha256_16}/{filename}
 *
 * Parameters:
 *   board        - curriculum board (e.g. "cbse")
 *   grade        - grade 6-12
 *   subject_code - subject code (e.g. "math", "phy", "chem", "bio")
 *   sha256       - 16-char hex prefix of the content hash
 *   type         - "pdf" (default), "json", "png", "jpg"
 *   filename     - optional explicit filename override
 *
 * The signed URL expires in 5 minutes (300s).
 *
 * AUTH: requires 'learning_source.view' permission (student/teacher roles;
 * admin/super_admin bypass via wildcard, per authorizeRequest()).
 *
 * RIGHTS CHECK: the `learning-sources` bucket has ZERO storage.objects
 * policies by deliberate design (see
 * supabase/migrations/20260816000001_learning_sources_bucket.sql) — it is
 * service-role-only, and this route is the ONLY enforcement point for both
 * WHO may fetch an asset (permission check) and WHETHER that asset is legally
 * servable (rights_status check against public.rag_content_sources, joined
 * via public.rag_content_documents on storage_bucket/storage_path). A path
 * that resolves to no document row, or to a source whose rights_status is
 * not one of public_domain/ncert_open/licensed, is treated identically to a
 * genuinely-missing object (same 404) so callers cannot probe which
 * restricted documents exist.
 *
 * P13: this route does NOT log the requested storage path to the
 * structured logger.
 */

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

function buildPath(
  board: string,
  grade: string,
  subjectCode: string,
  sha16: string,
  filename: string
): string {
  return `${board}/${grade}/${subjectCode}/${sha16}/${filename}`;
}

function validateParams(params: {
  board: string;
  grade: string;
  subjectCode: string;
  sha256: string;
  filename?: string;
}): { ok: boolean; error?: string } {
  const { board, grade, subjectCode, sha256, filename } = params;

  if (!board || board.trim() === '') {
    return { ok: false, error: 'board is required' };
  }
  if (!grade || grade.trim() === '') {
    return { ok: false, error: 'grade is required' };
  }
  if (!subjectCode || subjectCode.trim() === '') {
    return { ok: false, error: 'subject_code is required' };
  }
  if (!sha256 || sha256.trim() === '') {
    return { ok: false, error: 'sha256 is required' };
  }

  // sha256 must be at least 16 hex chars (we take the first 16)
  const hexMatch = sha256.match(/^[0-9a-f]{16,}$/i);
  if (!hexMatch) {
    return { ok: false, error: 'sha256 must be a hex string (at least 16 chars)' };
  }

  // board: strict charset — no slashes, dots, or other path-meaningful
  // characters. Path convention documented in
  // supabase/migrations/20260816000001_learning_sources_bucket.sql uses
  // e.g. 'CBSE'.
  if (!/^[a-z]{2,10}$/i.test(board)) {
    return { ok: false, error: 'board must be 2-10 alphabetic characters' };
  }

  // grade must be an EXACT string match against '6'..'12' (P5 — grades are
  // strings, never integers; do NOT parseInt, which would accept garbage
  // like '6/../../secret' since parseInt stops at the first non-digit).
  const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
  if (!VALID_GRADES.includes(grade)) {
    return { ok: false, error: 'grade must be one of: ' + VALID_GRADES.join(', ') };
  }

  // subject_code: 2-8 lowercase alphanumeric
  if (!/^[a-z][a-z0-9]{1,7}$/i.test(subjectCode)) {
    return { ok: false, error: 'subject_code must be 2-8 alphanumeric characters starting with a letter' };
  }

  // filename
  let fn = filename?.trim();
  if (!fn) {
    fn = 'source.pdf'; // default
  }

  // filename must not contain path separators or traversal
  if (fn.includes('/') || fn.includes('\\') || fn.includes('..')) {
    return { ok: false, error: 'filename contains invalid characters' };
  }

  // filename must have a safe extension
  const ext = fn.split('.').pop()?.toLowerCase();
  if (!ext || !['pdf', 'json', 'png', 'jpg', 'jpeg'].includes(ext)) {
    return { ok: false, error: 'filename must have a valid extension: pdf, json, png, jpg, jpeg' };
  }

  return { ok: true };
}

// Only these rights_status values may ever be served to a caller. The
// bucket carries NO storage.objects policies (service-role-only by design —
// see supabase/migrations/20260816000001_learning_sources_bucket.sql), so
// this route is the sole place that content-level access is enforced.
const SERVABLE_RIGHTS_STATUSES = new Set(['public_domain', 'ncert_open', 'licensed']);

function notFoundResponse() {
  return NextResponse.json(
    { error: 'Resource not found in learning-sources bucket' },
    { status: 404 }
  );
}

export async function GET(request: NextRequest) {
  // Auth: the `learning-sources` bucket has ZERO storage.objects policies
  // (deliberate — see supabase/migrations/20260816000001_learning_sources_bucket.sql).
  // It is service-role-only, so THIS ROUTE is the only enforcement point for
  // both who may fetch an asset (permission check, below) and whether the
  // asset is legally servable (rights_status check, below — see the
  // rag_content_sources lookup after path validation).
  const auth = await authorizeRequest(request, 'learning_source.view');
  if (!auth.authorized) {
    return auth.errorResponse!;
  }

  const sp = new URL(request.url).searchParams;
  const board = sp.get('board') || '';
  const grade = sp.get('grade') || '';
  const subjectCode = sp.get('subject_code') || '';
  const sha256 = sp.get('sha256') || '';
  const filename = sp.get('filename') || '';

  const validation = validateParams({ board, grade, subjectCode, sha256, filename });
  if (!validation.ok) {
    logger.warn('learning-sources: invalid request parameters', {
      board, grade, subjectCode, sha256Sha: sha256.slice(0, 8) + '...',
      error: validation.error,
      ip: request.headers.get('x-forwarded-for'),
    });
    return NextResponse.json(
      { error: validation.error },
      { status: 400 }
    );
  }

  // Derive the 16-char sha prefix
  const sha16 = sha256.slice(0, 16);

  // Determine the filename (default to source.pdf)
  const fn = filename?.trim() || 'source.pdf';

  // Build the storage path
  const storagePath = buildPath(board, grade, subjectCode, sha16, fn);

  try {
    // Rights check — the ONLY content-level access control for this bucket.
    // A path with no matching rag_content_documents row, or whose source
    // rights_status isn't in SERVABLE_RIGHTS_STATUSES (public_domain /
    // ncert_open / licensed), is treated identically to "genuinely missing"
    // — same 404, same message — so a caller cannot distinguish "restricted"
    // from "never existed" by response shape.
    const { data: docRow, error: docError } = await supabaseAdmin
      .from('rag_content_documents')
      .select('rag_content_sources!inner(rights_status)')
      .eq('storage_bucket', 'learning-sources')
      .eq('storage_path', storagePath)
      .maybeSingle();

    if (docError) {
      logger.error('learning-sources: rights lookup failed', {
        error: docError.message,
        ip: request.headers.get('x-forwarded-for'),
      });
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const source = (docRow as { rag_content_sources?: { rights_status?: string } | { rights_status?: string }[] } | null)
      ?.rag_content_sources;
    const rightsStatus = Array.isArray(source) ? source[0]?.rights_status : source?.rights_status;

    if (!docRow || !rightsStatus || !SERVABLE_RIGHTS_STATUSES.has(rightsStatus)) {
      return notFoundResponse();
    }

    // Mint the signed URL
    const { data, error } = await supabaseAdmin.storage
      .from('learning-sources')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (error) {
      const isNotFound = error.message.toLowerCase().includes('not found')
        || error.message.toLowerCase().includes('no such file');
      logger.warn('learning-sources: signed URL creation failed', {
        error: error.message,
        ip: request.headers.get('x-forwarded-for'),
      });
      return NextResponse.json(
        {
          error: isNotFound
            ? 'Resource not found in learning-sources bucket'
            : 'Failed to generate signed URL',
        },
        { status: isNotFound ? 404 : 500 }
      );
    }

    if (!data?.signedUrl) {
      return NextResponse.json(
        { error: 'Failed to generate signed URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      signed_url: data.signedUrl,
      expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      path: storagePath,
    });
  } catch (err) {
    logger.error('learning-sources: unexpected error', {
      error: err instanceof Error ? err.message : String(err),
      ip: request.headers.get('x-forwarded-for'),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
