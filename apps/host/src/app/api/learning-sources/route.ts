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
 * P13: this route does NOT log the requested path to the structured
 * logger beyond a minimal event id.
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

  // grade must be 6-12
  const gradeNum = parseInt(grade, 10);
  if (isNaN(gradeNum) || gradeNum < 6 || gradeNum > 12) {
    return { ok: false, error: 'grade must be a number from 6 to 12' };
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

export async function GET(request: NextRequest) {
  // Auth: any authenticated caller can request a signed URL. The bucket's
  // RLS policies enforce per-resource access; this route only validates path
  // shape and mints the signed URL. No specific permission code required —
  // just authentication (admin/super_admin bypass via wildcard).
  const auth = await authorizeRequest(request);
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

  // Mint the signed URL
  try {
    const { data, error } = await supabaseAdmin.storage
      .from('learning-sources')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (error) {
      const isNotFound = error.message.toLowerCase().includes('not found')
        || error.message.toLowerCase().includes('no such file');
      logger.warn('learning-sources: signed URL creation failed', {
        storagePath,
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
