/**
 * GET /api/public/v1/classes — Public API v1 (Track A.6).
 * ============================================================================
 * Returns the class roster metadata for the KEY's school (paginated). Scope:
 * `classes.read`.
 *
 * CONTRACT: identical to all /api/public/v1/* handlers —
 *   authorizePublicApiKey FIRST → tenant from auth.schoolId (the KEY) → scope-gated
 *   → rate-limit headers attached → stable v1 shape → P13 (no surplus PII; classes
 *   carry no student PII, only class metadata).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizePublicApiKey } from '@/lib/public-api/auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const auth = await authorizePublicApiKey(request, 'classes.read');
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

    const supabase = getSupabaseAdmin();

    const { data, error, count } = await supabase
      .from('classes')
      .select(
        'id, name, grade, section, academic_year, subject, class_code, is_active, created_at',
        { count: 'exact' },
      )
      .eq('school_id', schoolId)
      .is('deleted_at', null)
      .order('grade', { ascending: true })
      .order('section', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('public_api_classes_list_failed', {
        error: new Error(error.message),
        route: '/api/public/v1/classes',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch classes' },
        { status: 500, headers },
      );
    }

    const total = count ?? 0;
    return NextResponse.json(
      {
        success: true,
        data: (data ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          grade: c.grade, // P5: string
          section: c.section,
          academic_year: c.academic_year,
          subject: c.subject,
          class_code: c.class_code,
          is_active: c.is_active,
          created_at: c.created_at,
        })),
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      },
      { headers },
    );
  } catch (err) {
    logger.error('public_api_classes_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/public/v1/classes',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers },
    );
  }
}
