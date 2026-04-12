import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * Generate a random 6-character alphanumeric invite code.
 * Uses characters that avoid visual ambiguity (no 0/O, 1/I/l).
 */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * POST /api/schools/setup/invite-codes — Generate invite codes
 * Permission: institution.manage
 *
 * Body: {
 *   school_id: string,
 *   codes: [{
 *     role: 'student' | 'teacher',
 *     class_id?: string,
 *     max_uses?: number,
 *     expires_days?: number
 *   }]
 * }
 *
 * Also supports single code generation:
 * Body: { school_id, role, class_id?, max_uses?, expires_days? }
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'institution.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();
    const { school_id } = body;

    if (!school_id || typeof school_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'school_id is required' },
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

    // Normalize to array (support single or batch)
    const codeRequests: Array<{
      role: string;
      class_id?: string;
      max_uses?: number;
      expires_days?: number;
    }> = body.codes ?? [body];

    if (codeRequests.length > 20) {
      return NextResponse.json(
        { success: false, error: 'Maximum 20 codes per request' },
        { status: 400 }
      );
    }

    const validRoles = ['student', 'teacher'];
    const errors: string[] = [];
    const rows = codeRequests.map((req, idx) => {
      if (!req.role || !validRoles.includes(req.role)) {
        errors.push(`Code ${idx + 1}: role must be 'student' or 'teacher'`);
      }

      const maxUses = req.max_uses ?? 50;
      if (maxUses < 1 || maxUses > 500) {
        errors.push(`Code ${idx + 1}: max_uses must be 1-500`);
      }

      const expiresDays = req.expires_days ?? 90;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresDays);

      return {
        school_id,
        code: generateCode(),
        role: req.role,
        class_id: req.class_id || null,
        max_uses: maxUses,
        uses_count: 0,
        expires_at: expiresAt.toISOString(),
        created_by: auth.userId,
        is_active: true,
      };
    });

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, error: errors.join('; ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('school_invite_codes')
      .insert(rows)
      .select('id, code, role, class_id, max_uses, expires_at');

    if (error) {
      // If code collision, retry with new codes
      if (error.code === '23505') {
        // Regenerate codes and retry once
        const retryRows = rows.map((r) => ({ ...r, code: generateCode() }));
        const { data: retryData, error: retryError } = await supabaseAdmin
          .from('school_invite_codes')
          .insert(retryRows)
          .select('id, code, role, class_id, max_uses, expires_at');

        if (retryError) {
          logger.error('school_invite_codes_retry_failed', {
            error: retryError,
            route: '/api/schools/setup/invite-codes',
          });
          return NextResponse.json(
            { success: false, error: 'Failed to generate invite codes' },
            { status: 500 }
          );
        }

        logAudit(auth.userId, {
          action: 'create',
          resourceType: 'school_invite_codes',
          resourceId: school_id,
        });

        return NextResponse.json({ success: true, data: retryData ?? [] });
      }

      logger.error('school_invite_codes_create_failed', {
        error,
        route: '/api/schools/setup/invite-codes',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to generate invite codes' },
        { status: 500 }
      );
    }

    logAudit(auth.userId, {
      action: 'create',
      resourceType: 'school_invite_codes',
      resourceId: school_id,
    });

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    logger.error('school_invite_codes_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/schools/setup/invite-codes',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
