import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { authenticateApiKey } from '@/lib/school-api-auth';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

/**
 * GET /api/v1/school/students — Public API for ERP integration
 *
 * Auth: API key with 'students.read' permission
 * Query params:
 *   ?grade=    — filter by grade (string "6"-"12", per P5)
 *   ?page=     — page number (default 1)
 *   ?limit=    — items per page (default 50, max 100)
 *
 * Returns: student list scoped to the API key's school_id
 * Fields: id, name, grade (string per P5), email, is_active, xp_total, last_active
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired API key' },
        { status: 401 }
      );
    }

    // Check permission
    if (!auth.permissions.includes('students.read')) {
      return NextResponse.json(
        { success: false, error: 'API key does not have students.read permission' },
        { status: 403 }
      );
    }

    // Per-API-key rate limiting (100 req/min default)
    const rateLimit = await checkApiRateLimit(auth.keyId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, rateLimit.resetAt - Math.ceil(Date.now() / 1000))),
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateLimit.resetAt),
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const grade = searchParams.get('grade');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    // P5: Validate grade is a string "6"-"12"
    const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
    if (grade && !VALID_GRADES.includes(grade)) {
      return NextResponse.json(
        { success: false, error: 'Invalid grade. Must be a string "6" through "12".' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Query students scoped to the API key's school_id
    let query = supabase
      .from('students')
      .select('id, name, grade, email, is_active, xp_total, last_active', { count: 'exact' })
      .eq('school_id', auth.schoolId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (grade) {
      query = query.eq('grade', grade);
    }

    const { data: students, error, count } = await query;

    // Rate limit headers attached to every response
    const rlHeaders = {
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': String(rateLimit.remaining),
      'X-RateLimit-Reset': String(rateLimit.resetAt),
    };

    if (error) {
      logger.error('public_school_students_error', {
        error: new Error(error.message),
        route: '/api/v1/school/students',
        schoolId: auth.schoolId,
        keyId: auth.keyId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch students' },
        { status: 500, headers: rlHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          students: students ?? [],
          pagination: {
            page,
            limit,
            total: count ?? 0,
            total_pages: count ? Math.ceil(count / limit) : 0,
          },
        },
      },
      { headers: rlHeaders }
    );
  } catch (err) {
    logger.error('public_school_students_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v1/school/students',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
