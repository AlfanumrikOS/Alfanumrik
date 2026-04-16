import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/teachers?page=1&limit=20
 *
 * Paginated list of teachers for the admin's school.
 * Permission: institution.manage_teachers
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_teachers');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('teachers')
      .select('id, name, email, phone, subjects_taught, grades_taught, is_active, created_at', {
        count: 'exact',
      })
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('school_admin_teachers_list_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/teachers',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch teachers' },
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
    logger.error('school_admin_teachers_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/teachers',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/school-admin/teachers
 *
 * Create a new teacher in the admin's school.
 * Permission: institution.manage_teachers
 *
 * Body: { name: string, email: string, phone?: string, subjects_taught?: string[], grades_taught?: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_teachers');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const body = await request.json();

    // Validate required fields
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Teacher name is required' },
        { status: 400 }
      );
    }

    if (!body.email || typeof body.email !== 'string' || !isValidEmail(body.email)) {
      return NextResponse.json(
        { success: false, error: 'Valid email is required' },
        { status: 400 }
      );
    }

    // Validate grades are strings "6"-"12" (P5)
    const gradesTaught: string[] = Array.isArray(body.grades_taught) ? body.grades_taught : [];
    const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
    for (const g of gradesTaught) {
      if (typeof g !== 'string' || !validGrades.includes(g)) {
        return NextResponse.json(
          { success: false, error: `Invalid grade: "${g}". Grades must be strings "6" through "12"` },
          { status: 400 }
        );
      }
    }

    // Check for duplicate email within the same school
    const { data: existing } = await supabase
      .from('teachers')
      .select('id')
      .eq('school_id', schoolId)
      .eq('email', body.email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'A teacher with this email already exists in your school' },
        { status: 409 }
      );
    }

    const { data: teacher, error: insertError } = await supabase
      .from('teachers')
      .insert({
        school_id: schoolId,
        name: body.name.trim(),
        email: body.email.trim().toLowerCase(),
        phone: body.phone?.trim() || null,
        subjects_taught: Array.isArray(body.subjects_taught) ? body.subjects_taught : [],
        grades_taught: gradesTaught,
        is_active: true,
      })
      .select('id, name, email, phone, subjects_taught, grades_taught, is_active, created_at')
      .single();

    if (insertError) {
      logger.error('school_admin_teacher_create_failed', {
        error: new Error(insertError.message),
        route: '/api/school-admin/teachers',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create teacher' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: teacher }, { status: 201 });
  } catch (err) {
    logger.error('school_admin_teachers_post_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/teachers',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/school-admin/teachers
 *
 * Update a teacher's details.
 * Permission: institution.manage_teachers
 *
 * Body: { id: string, name?: string, subjects_taught?: string[], grades_taught?: string[], is_active?: boolean }
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_teachers');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const body = await request.json();

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Teacher id is required' },
        { status: 400 }
      );
    }

    // Verify teacher belongs to this school (tenant isolation)
    const { data: existingTeacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('id', body.id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (!existingTeacher) {
      return NextResponse.json(
        { success: false, error: 'Teacher not found' },
        { status: 404 }
      );
    }

    // Build update object with only allowed fields
    const updateFields: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'Name cannot be empty' },
          { status: 400 }
        );
      }
      updateFields.name = body.name.trim();
    }

    if (body.subjects_taught !== undefined) {
      if (!Array.isArray(body.subjects_taught)) {
        return NextResponse.json(
          { success: false, error: 'subjects_taught must be an array' },
          { status: 400 }
        );
      }
      updateFields.subjects_taught = body.subjects_taught;
    }

    if (body.grades_taught !== undefined) {
      if (!Array.isArray(body.grades_taught)) {
        return NextResponse.json(
          { success: false, error: 'grades_taught must be an array' },
          { status: 400 }
        );
      }
      // Validate grades are strings "6"-"12" (P5)
      const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
      for (const g of body.grades_taught) {
        if (typeof g !== 'string' || !validGrades.includes(g)) {
          return NextResponse.json(
            { success: false, error: `Invalid grade: "${g}". Grades must be strings "6" through "12"` },
            { status: 400 }
          );
        }
      }
      updateFields.grades_taught = body.grades_taught;
    }

    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json(
          { success: false, error: 'is_active must be a boolean' },
          { status: 400 }
        );
      }
      updateFields.is_active = body.is_active;
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from('teachers')
      .update(updateFields)
      .eq('id', body.id)
      .eq('school_id', schoolId) // double-check tenant isolation
      .select('id, name, email, phone, subjects_taught, grades_taught, is_active, created_at')
      .single();

    if (updateError) {
      logger.error('school_admin_teacher_update_failed', {
        error: new Error(updateError.message),
        route: '/api/school-admin/teachers',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update teacher' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    logger.error('school_admin_teachers_patch_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/teachers',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** Basic email format check */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
