import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logSchoolAudit } from '@/lib/audit';
import {
  deliverEmail,
  pickLocaleFromAcceptLanguage,
  truncateInviteCode,
} from '@/lib/email-delivery';
import {
  isSeatEnforcementEnabled,
  remainingCapacity,
} from '@/lib/school-admin/seat-enforcement';

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
 * Body: {
 *   role: 'teacher' | 'student',
 *   max_uses?: number,
 *   expires_in_days?: number,
 *   recipient_email?: string,    // optional — if provided, an invite email is sent
 *   recipient_name?: string,     // optional — used in the email greeting
 * }
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

    // Optional recipient_email — validate shape only if provided.
    const recipientEmail =
      typeof body.recipient_email === 'string' ? body.recipient_email.trim().toLowerCase() : '';
    const recipientName =
      typeof body.recipient_name === 'string' ? body.recipient_name.trim() : '';
    if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return NextResponse.json(
        { success: false, error: 'recipient_email is not a valid email address' },
        { status: 400 }
      );
    }

    // Validate max_uses (default 50 for students, 1 for teachers)
    const defaultMaxUses = body.role === 'teacher' ? 1 : 50;
    let maxUses = typeof body.max_uses === 'number'
      ? Math.min(100, Math.max(1, body.max_uses))
      : defaultMaxUses;

    // ── Seat-bounded issuance (Phase 3B Wave B) ─────────────────────────
    // When ff_school_provisioning is ON, a STUDENT invite code can grant at
    // most the school's remaining seat capacity (within the grace ceiling).
    // We cap the effective max_uses so issuing a code can never authorize more
    // student joins than there are seats to fill. Teacher codes are not seat-
    // bounded (teachers are not seats). If capacity is exhausted, refuse with a
    // 409 seat_cap_violation rather than minting a 0-use code. Redemption is
    // handled by the PUBLIC /api/schools/join route (outside the school-admin
    // portal) and is NOT modified in Wave B — documented as a follow-up.
    // Flag OFF → max_uses is unchanged (byte-identical to today).
    let seatCapInfo: { remaining: number } | null = null;
    if (body.role === 'student' && (await isSeatEnforcementEnabled())) {
      const remaining = await remainingCapacity(schoolId);
      if (remaining === null) {
        return NextResponse.json(
          { success: false, error: 'Seat check temporarily unavailable. Please retry.' },
          { status: 503 }
        );
      }
      if (remaining <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'seat_cap_violation',
            status: 'over_ceiling',
            remaining_seats: 0,
          },
          { status: 409 }
        );
      }
      maxUses = Math.min(maxUses, remaining);
      seatCapInfo = { remaining };
    }

    // Validate expires_in_days (default 30, min 1, max 365)
    const expiresInDays = typeof body.expires_in_days === 'number'
      ? Math.min(365, Math.max(1, body.expires_in_days))
      : 30;

    // Get school slug + display name for code prefix and email branding
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('slug, name')
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

    // ── Fire-and-forget invite email (Phase B.2) ──
    // Only dispatches when the caller supplied a recipient_email — otherwise
    // the code is returned in JSON for manual hand-off (legacy behaviour).
    // Email failure MUST NOT fail the API response.
    if (recipientEmail) {
      const locale = pickLocaleFromAcceptLanguage(
        request.headers.get('accept-language')
      );
      const slug = school.slug || 'school';
      void deliverEmail({
        template: 'school-invite-code-issued',
        to: recipientEmail,
        locale,
        params: {
          school_name: school.name || 'Your school',
          invite_code: code,
          expires_at: expiresAt.toISOString(),
          subdomain_url: `https://${slug}.alfanumrik.com`,
          recipient_name: recipientName || undefined,
        },
      }).catch((err) => {
        logger.warn('school_admin_invite_email_dispatch_failed', {
          schoolId,
          codeTruncated: truncateInviteCode(code),
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: seatCapInfo
          ? { ...inviteCode, max_uses_capped_to_seats: maxUses, remaining_seats: seatCapInfo.remaining }
          : inviteCode,
      },
      { status: 201 }
    );
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

    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: 'invite_code.revoked',
      resourceType: 'school_invite_code',
      resourceId: body.id,
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

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
