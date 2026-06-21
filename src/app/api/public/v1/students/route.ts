/**
 * GET /api/public/v1/students — Public API v1 (Track A.6).
 * ============================================================================
 * Returns the student roster for the KEY's school (paginated). Scope:
 * `students.read`.
 *
 * CONTRACT (src/lib/public-api/README.md + auth.ts):
 *   1. authorizePublicApiKey(request, 'students.read') FIRST — before any DB I/O.
 *   2. Tenant is auth.schoolId (from the KEY) — NEVER from the request. No
 *      school_id is read from the path/query/body.
 *   3. Scope-gated by the helper (403 if the key lacks students.read).
 *   4. Rate-limit headers (auth.rateLimitHeaders) attached to the success response.
 *   5. P13: NO PII. We expose id, name, grade, is_active, created_at — NEVER email
 *      or phone. (name is the minimal label an institutional integration needs to
 *      map its own roster; email/phone are withheld.)
 *
 * v1 shape is STABLE + additive-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizePublicApiKey } from '@/lib/public-api/auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  // 1. Authenticate + scope-gate + rate-limit FIRST.
  const auth = await authorizePublicApiKey(request, 'students.read');
  if (!auth.authorized) return auth.errorResponse!;

  const schoolId = auth.schoolId!; // tenant from the KEY only
  const headers = auth.rateLimitHeaders;

  try {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    );
    const offset = (page - 1) * limit;
    const grade = url.searchParams.get('grade') ?? '';

    if (grade && !VALID_GRADES.includes(grade)) {
      return NextResponse.json(
        { success: false, error: `Invalid grade filter: "${grade}". Must be "6" through "12"` },
        { status: 400, headers },
      );
    }

    const supabase = getSupabaseAdmin();

    // P13: NO email/phone. Tenant scoped to the key's school.
    let query = supabase
      .from('students')
      .select('id, name, grade, is_active, created_at', { count: 'exact' })
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (grade) query = query.eq('grade', grade);

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      logger.error('public_api_students_list_failed', {
        error: new Error(error.message),
        route: '/api/public/v1/students',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch students' },
        { status: 500, headers },
      );
    }

    const total = count ?? 0;
    return NextResponse.json(
      {
        success: true,
        data: (data ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          grade: s.grade, // P5: string "6".."12"
          is_active: s.is_active,
          created_at: s.created_at,
        })),
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      },
      { headers },
    );
  } catch (err) {
    logger.error('public_api_students_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/public/v1/students',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers },
    );
  }
}
