/**
 * POST /api/auth/repair
 *
 * Admin-only: repairs broken onboarding for a specific user.
 * Requires admin.manage_users permission via authorizeRequest.
 *
 * WARNING: Do not modify without updating auth/onboarding tests.
 *
 * Request body: { auth_user_id: string, force_role?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { authorizeRequest } from '@/lib/rbac';
import { VALID_ROLES, isValidRole } from '@/lib/identity';
import { logIdentityEvent } from '@/lib/identity/audit';

export async function POST(request: NextRequest) {
  try {
    // Admin authorization via RBAC (P9)
    const auth = await authorizeRequest(request, 'admin.manage_users');
    if (!auth.authorized) return auth.errorResponse!;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { auth_user_id, force_role } = body as {
      auth_user_id?: string;
      force_role?: string;
    };

    if (!auth_user_id || typeof auth_user_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'auth_user_id is required' },
        { status: 400 }
      );
    }

    // Validate UUID format (basic check)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(auth_user_id)) {
      return NextResponse.json(
        { success: false, error: 'auth_user_id must be a valid UUID' },
        { status: 400 }
      );
    }

    if (force_role && !isValidRole(force_role)) {
      return NextResponse.json(
        {
          success: false,
          error: `force_role must be one of: ${VALID_ROLES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    const { data, error } = await admin.rpc('admin_repair_user_onboarding', {
      p_auth_user_id: auth_user_id,
      p_force_role: force_role || null,
    });

    if (error) {
      console.error('[Repair] RPC failed:', error.message, { auth_user_id });
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // Audit log via centralized identity audit module (best-effort)
    await logIdentityEvent(
      { supabase: admin, authUserId: auth_user_id },
      'admin_repair',
      { repaired_by: auth.userId, result: data }
    );

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[Repair] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
