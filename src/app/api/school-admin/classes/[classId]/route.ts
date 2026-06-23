import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logSchoolAudit } from '@/lib/audit';

/**
 * PATCH /api/school-admin/classes/[classId]
 *
 * Assign a teacher to a class via the class_teachers junction table.
 * NOTE: the classes table has NO teacher_id column — assignment lives in class_teachers.
 * Permission: class.manage
 *
 * Body: { teacher_id: string }
 * P8: validates both class and teacher belong to admin school before writing.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'class.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const { classId } = await params;
    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    if (!classId || typeof classId !== 'string') {
      return NextResponse.json({ success: false, error: 'classId is required' }, { status: 400 });
    }

    const body = await request.json();
    if (!body.teacher_id || typeof body.teacher_id !== 'string' || !body.teacher_id.trim()) {
      return NextResponse.json({ success: false, error: 'teacher_id is required' }, { status: 400 });
    }
    const teacherId = body.teacher_id.trim();

    // Verify class belongs to this school (P8 tenant isolation)
    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, grade, section, academic_year, subject, class_code, is_active')
      .eq('id', classId)
      .eq('school_id', schoolId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!cls) {
      return NextResponse.json({ success: false, error: 'Class not found' }, { status: 404 });
    }

    // Verify teacher belongs to this school (cross-school prevention)
    const { data: teacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('id', teacherId)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (!teacher) {
      return NextResponse.json(
        { success: false, error: 'Teacher not found in this school' },
        { status: 404 }
      );
    }

    // UPSERT into class_teachers — insert or reactivate existing assignment
    const { data: assignment, error: upsertError } = await supabase
      .from('class_teachers')
      .upsert(
        { class_id: classId, teacher_id: teacherId, role: 'teacher', is_active: true },
        { onConflict: 'class_id,teacher_id', ignoreDuplicates: false }
      )
      .select('id, class_id, teacher_id, role, is_active')
      .single();

    if (upsertError) {
      logger.error('school_admin_class_teacher_assign_failed', {
        error: new Error(upsertError.message),
        route: '/api/school-admin/classes/[classId]',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to assign teacher' },
        { status: 500 }
      );
    }

    // Audit — IDs only, no names/emails (P13)
    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: 'class.teacher_assigned',
      resourceType: 'class',
      resourceId: classId,
      metadata: { teacher_id: teacherId },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        assignment_id: assignment.id,
        class_id: cls.id,
        class_name: cls.name,
        grade: cls.grade,     // P5: grade as string "6"-"12"
        section: cls.section,
        teacher_id: teacherId,
        role: assignment.role,
        is_active: assignment.is_active,
      },
    });
  } catch (err) {
    logger.error('school_admin_class_assign_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/classes/[classId]',
    });
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
