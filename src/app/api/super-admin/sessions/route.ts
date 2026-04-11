/**
 * Super Admin — Session Management
 *
 * GET  — List sessions for a specific user (admin only)
 * POST — Force-logout: revoke all active sessions for a user (admin only)
 *
 * Requires admin authentication via authorizeAdmin().
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET — List sessions for a user.
 *
 * Query params:
 *   user_id (required) — the auth_user_id to look up
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
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
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
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
