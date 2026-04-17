import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/invite-codes
 *
 * List all invite codes for the admin's school.
 * Permission: institution.manage_students (invite codes are used for onboarding)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('school_invite_codes')
      .select('id, code, role, max_uses, uses_count, expires_at, is_active, created_by, created_at')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('school_admin_invite_codes_list_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/invite-codes',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch invite codes' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: data ?? [],
    });
  } catch (err) {
    logger.error('school_admin_invite_codes_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/invite-codes',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/school-admin/invite-codes
 *
 * Generate a new invite code.
 * Permission: institution.manage_students
 *
 * Body: { role: 'teacher' | 'student', max_uses?: number, expires_in_days?: number }
 *
 * Code format: {SCHOOL_SLUG}-{random6chars}
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const body = await request.json();

    // Validate role
    const validRoles = ['teacher', 'student'];
    if (!body.role || !validRoles.includes(body.role)) {
      return NextResponse.json(
        { success: false, error: 'role must be "teacher" or "student"' },
        { status: 400 }
      );
    }

    // Validate max_uses (default 50 for students, 1 for teachers)
    const defaultMaxUses = body.role === 'teacher' ? 1 : 50;
    const maxUses = typeof body.max_uses === 'number'
      ? Math.min(100, Math.max(1, body.max_uses))
      : defaultMaxUses;

    // Validate expires_in_days (default 30, min 1, max 365)
    const expiresInDays = typeof body.expires_in_days === 'number'
      ? Math.min(365, Math.max(1, body.expires_in_days))
      : 30;

    // Get school slug for code prefix
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('slug')
      .eq('id', schoolId)
      .single();

    if (schoolError || !school) {
      logger.error('school_admin_invite_school_lookup_failed', {
        error: schoolError ? new Error(schoolError.message) : new Error('School not found'),
        route: '/api/school-admin/invite-codes',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to look up school' },
        { status: 500 }
      );
    }

    // Generate code: {slug prefix (up to 6 chars)}-{random 6 alphanumeric}
    const prefix = (school.slug || 'school').slice(0, 6).toUpperCase();
    const randomPart = generateRandomCode(6);
    const code = `${prefix}-${randomPart}`;

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const { data: inviteCode, error: insertError } = await supabase
      .from('school_invite_codes')
      .insert({
        school_id: schoolId,
        code,
        role: body.role,
        max_uses: maxUses,
        uses_count: 0,
        expires_at: expiresAt.toISOString(),
        is_active: true,
        created_by: auth.schoolAdminId,
      })
      .select('id, code, role, max_uses, uses_count, expires_at, is_active, created_at')
      .single();

    if (insertError) {
      logger.error('school_admin_invite_code_create_failed', {
        error: new Error(insertError.message),
        route: '/api/school-admin/invite-codes',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create invite code' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: inviteCode }, { status: 201 });
  } catch (err) {
    logger.error('school_admin_invite_codes_post_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/invite-codes',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/school-admin/invite-codes
 *
 * Deactivate an invite code (soft delete: sets is_active = false).
 * Permission: institution.manage_students
 *
 * Body: { id: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const body = await request.json();

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invite code id is required' },
        { status: 400 }
      );
    }

    // Verify the invite code belongs to this school (tenant isolation)
    const { data: existing } = await supabase
      .from('school_invite_codes')
      .select('id')
      .eq('id', body.id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Invite code not found' },
        { status: 404 }
      );
    }

    const { error: updateError } = await supabase
      .from('school_invite_codes')
      .update({ is_active: false })
      .eq('id', body.id)
      .eq('school_id', schoolId); // double-check tenant isolation

    if (updateError) {
      logger.error('school_admin_invite_code_deactivate_failed', {
        error: new Error(updateError.message),
        route: '/api/school-admin/invite-codes',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to deactivate invite code' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: { id: body.id, is_active: false } });
  } catch (err) {
    logger.error('school_admin_invite_codes_delete_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/invite-codes',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** Generate a random alphanumeric string of the given length */
function generateRandomCode(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
