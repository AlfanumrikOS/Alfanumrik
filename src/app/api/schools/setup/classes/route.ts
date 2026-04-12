import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

/**
 * POST /api/schools/setup/classes — Create classes for a school
 * Permission: institution.manage
 *
 * Body: { school_id, classes: [{ name, grade, section? }] }
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'institution.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();
    const { school_id, classes } = body;

    if (!school_id || typeof school_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'school_id is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(classes) || classes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one class is required' },
        { status: 400 }
      );
    }

    if (classes.length > 50) {
      return NextResponse.json(
        { success: false, error: 'Maximum 50 classes per request' },
        { status: 400 }
      );
    }

    // Verify the user is admin of this school
    const { data: adminRecord } = await supabaseAdmin
      .from('school_admins')
      .select('school_id')
      .eq('auth_user_id', auth.userId)
      .eq('school_id', school_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!adminRecord) {
      return NextResponse.json(
        { success: false, error: 'Not authorized for this school' },
        { status: 403 }
      );
    }

    // Validate each class
    const errors: string[] = [];
    const classRows = classes.map((cls: { name?: string; grade?: string; section?: string }, idx: number) => {
      if (!cls.name || typeof cls.name !== 'string' || cls.name.trim().length < 1) {
        errors.push(`Class ${idx + 1}: name is required`);
      }
      if (!cls.grade || !VALID_GRADES.includes(String(cls.grade))) {
        errors.push(`Class ${idx + 1}: grade must be one of ${VALID_GRADES.join(', ')}`);
      }
      return {
        school_id,
        name: cls.name?.trim() ?? '',
        grade: String(cls.grade ?? ''),
        section: cls.section?.trim() || null,
        created_by: auth.userId,
      };
    });

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, error: errors.join('; ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('classes')
      .insert(classRows)
      .select('id, name, grade, section');

    if (error) {
      logger.error('school_classes_create_failed', {
        error,
        route: '/api/schools/setup/classes',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create classes' },
        { status: 500 }
      );
    }

    logAudit(auth.userId, {
      action: 'create',
      resourceType: 'school_classes',
      resourceId: school_id,
    });

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    logger.error('school_classes_create_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/schools/setup/classes',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
