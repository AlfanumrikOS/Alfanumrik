import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logSchoolAudit } from '@/lib/audit';

/**
 * PATCH /api/school-admin/classes/[classId]
 *
 * Assign or reassign a teacher to a class.
 * Permission: class.manage
 *
 * Body: { teacher_id: string }
 *
 * Cross-school safety: validates both class and teacher belong to the admin's school
 * before writing (P8 tenant isolation).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { classId: string } }
) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'class.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const { classId } = params;
    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    if (!classId || typeof classId !== 'string') {
      return NextResponse.json({ success: false, error: 'classId is required' }, { status: 400 });
    }

    const body = await request.json();

    if (!body.teacher_id || typeof body.teacher_id !== 'string' || !body.teacher_id.trim()) {
      return NextResponse.json(
        { success: false, error: 'teacher_id is required' },
        { status: 400 }
      );
    }

    const teacherId = body.teacher_id.trim();

    // Verify class belongs to this school (P8: tenant isolation)
    const { data: cls } = await supabase
      .from('classes')
      .select('id')
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

    // Assign the teacher
    const { data: updated, error: updateError } = await supabase
      .from('classes')
      .update({ teacher_id: teacherId })
      .eq('id', classId)
      .eq('school_id', schoolId) // double-check tenant isolation
      .select('id, name, grade, section, academic_year, subject, class_code, is_active, teacher_id')
      .single();

    if (updateError) {
      logger.error('school_admin_class_teacher_assign_failed', {
        error: new Error(updateError.message),
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

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    logger.error('school_admin_class_assign_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/classes/[classId]',
    });
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
