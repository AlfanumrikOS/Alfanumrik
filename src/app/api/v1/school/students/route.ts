import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * Authenticate an incoming request using a school API key.
 *
 * Expects: Authorization: Bearer sk_school_...
 * Verifies: SHA-256 hash matches, key is active, not expired.
 * Returns school_id + key permissions on success, null on failure.
 */
async function authenticateApiKey(
  request: NextRequest
): Promise<{ schoolId: string; keyId: string; permissions: string[] } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer sk_school_')) return null;

  const key = authHeader.replace('Bearer ', '');

  // SHA-256 hash the provided key (Edge-compatible)
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from('school_api_keys')
    .select('id, school_id, permissions, expires_at')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single();

  if (!data) return null;

  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last_used_at (fire and forget — don't block the response)
  supabase
    .from('school_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    schoolId: data.school_id,
    keyId: data.id,
    permissions: data.permissions ?? [],
  };
}

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

    if (error) {
      logger.error('public_school_students_error', {
        error: new Error(error.message),
        route: '/api/v1/school/students',
        schoolId: auth.schoolId,
        keyId: auth.keyId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch students' },
        { status: 500 }
      );
    }

    return NextResponse.json({
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
    });
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
