/**
 * Super Admin — Session Management
 *
 * GET  — List sessions for a specific user ('support' level — read-only,
 *        metadata-only response: device_label/ip_address/timestamps/
 *        is_active/revoked_at from user_active_sessions, no PII beyond IP,
 *        no account/financial content).
 * POST — Force-logout: revoke all active sessions for a user + global
 *        GoTrue signOut. DESTRUCTIVE — raised to 'admin' level (2026-08-16,
 *        Phase 0 super-admin overhaul, "force-logout safety" release
 *        blocker). Was previously gated at 'support', the lowest tier on
 *        the ADMIN_LEVELS ladder (support < analyst < content_manager <
 *        finance < admin < super_admin) — any active admin_users row could
 *        kick any user off every device.
 *
 * Requires operator authentication via authorizeOperator() — Phase 1 pilot
 * migration off authorizeAdmin() (2026-08-16, Mission Control overhaul).
 * authorizeOperator() enforces the SAME 6-tier floor (support < analyst <
 * content_manager < finance < admin < super_admin), but resolved from RBAC
 * (user_roles/roles, kept in sync with admin_users.admin_level by the
 * sync_admin_level_to_rbac_role() trigger — migration 20260816000008)
 * instead of reading admin_users.admin_level directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeOperator, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * GET — List sessions for a user.
 *
 * Query params:
 *   user_id (required) — the auth_user_id to look up
 *
 * Kept at 'support' (the floor): the response is session metadata only
 * (device_label, ip_address, created_at/last_seen_at/revoked_at,
 * is_active) — no email/phone/name, no account or financial content.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeOperator(request, 'support');
  if (!auth.authorized) return auth.response;

  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: sessions, error } = await admin
      .from('user_active_sessions')
      .select('id, device_label, ip_address, created_at, last_seen_at, is_active, revoked_at')
      .eq('auth_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
    }

    return NextResponse.json({ sessions: sessions || [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * POST — Force-logout: revoke all active sessions for a user.
 *
 * Body: { user_id: string }
 *
 * Also calls Supabase admin signOut to invalidate refresh tokens.
 *
 * Requires 'admin' level or higher — destructive, account-wide action
 * (2026-08-16 floor raise; was 'support').
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeOperator(request, 'admin');
  if (!auth.authorized) return auth.response;

  let targetUserId: string;
  try {
    const body = await request.json();
    targetUserId = body.user_id;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!targetUserId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();

    // Revoke all active sessions
    const { data: revoked, error } = await admin
      .from('user_active_sessions')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('auth_user_id', targetUserId)
      .eq('is_active', true)
      .select('id');

    if (error) {
      return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });
    }

    const revokedCount = revoked?.length || 0;

    // Log identity event (best-effort)
    try {
      await admin.from('identity_events').insert({
        auth_user_id: targetUserId,
        event_type: 'admin_force_logout',
        metadata: {
          revoked_by: auth.userId,
          sessions_revoked: revokedCount,
        },
      });
    } catch { /* best-effort */ }

    // Also revoke Supabase refresh tokens via admin API
    try {
      await admin.auth.admin.signOut(targetUserId, 'global');
    } catch {
      // If Supabase admin signout fails, session cookies are still revoked.
      // User will be kicked on next proxy.ts / middleware check.
    }

    // Audit log for admin action
    await logAdminAudit(
      auth,
      'force_logout',
      'user',
      targetUserId,
      { sessions_revoked: revokedCount },
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
    );

    return NextResponse.json({
      status: 'revoked',
      sessions_revoked: revokedCount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
