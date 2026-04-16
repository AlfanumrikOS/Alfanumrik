import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/students?page=1&limit=20&grade=8&search=name
 *
 * Paginated, filterable list of students for the admin's school.
 * Permission: institution.manage_students
 *
 * Query params:
 *   page    — page number (default 1)
 *   limit   — items per page (default 20, max 100)
 *   grade   — filter by grade string "6"-"12" (P5)
 *   search  — case-insensitive name search
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const offset = (page - 1) * limit;
    const grade = url.searchParams.get('grade') ?? '';
    const search = url.searchParams.get('search')?.trim() ?? '';

    // Validate grade filter if provided (P5: grades are strings "6"-"12")
    const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
    if (grade && !validGrades.includes(grade)) {
      return NextResponse.json(
        { success: false, error: `Invalid grade filter: "${grade}". Must be "6" through "12"` },
        { status: 400 }
      );
    }

    // Build query — always scoped to schoolId
    let query = supabase
      .from('students')
      .select(
        'id, name, email, grade, is_active, xp_total, last_active, subscription_plan, created_at',
        { count: 'exact' }
      )
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    // Apply optional filters
    if (grade) {
      query = query.eq('grade', grade);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('school_admin_students_list_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/students',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch students' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (err) {
    logger.error('school_admin_students_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/students',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/school-admin/students
 *
 * Toggle a student's is_active status.
 * School admins can only toggle active/inactive — they cannot edit student profiles.
 * Permission: institution.manage_students
 *
 * Body: { id: string, is_active: boolean }
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const body = await request.json();

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Student id is required' },
        { status: 400 }
      );
    }

    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'is_active must be a boolean' },
        { status: 400 }
      );
    }

    // Verify student belongs to this school (tenant isolation)
    const { data: existingStudent } = await supabase
      .from('students')
      .select('id')
      .eq('id', body.id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (!existingStudent) {
      return NextResponse.json(
        { success: false, error: 'Student not found' },
        { status: 404 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from('students')
      .update({ is_active: body.is_active })
      .eq('id', body.id)
      .eq('school_id', schoolId) // double-check tenant isolation
      .select('id, name, email, grade, is_active')
      .single();

    if (updateError) {
      logger.error('school_admin_student_toggle_failed', {
        error: new Error(updateError.message),
        route: '/api/school-admin/students',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update student' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    logger.error('school_admin_students_patch_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/students',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
