/**
 * CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break login/signup/verify/reset for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Run: node scripts/auth-guard.js
 * 3. Test ALL flows manually: signup, login, verify email, reset password, logout
 * 4. Verify on Chrome: /login renders, /dashboard redirects to /login when unauthenticated
 *
 * DO NOT: create middleware.ts, add client-side profile inserts, remove role tabs
 */
/**
 * Session Management API
 *
 * POST  — Register a new device session (enforces 2-device limit)
 * GET   — List current user's sessions
 * DELETE — Logout (revoke current session)
 *
 * Uses `user_active_sessions` table. Session ID stored in httpOnly cookie.
 * Fail-open: session failures never block the auth flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const MAX_SESSIONS = 2;
const SESSION_COOKIE = 'alfanumrik_sid';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/**
 * POST — Register a new session for the authenticated user.
 *
 * If the user already has a valid session cookie, refreshes last_seen_at.
 * If at the device limit, revokes the oldest session(s) and logs the event.
 * Sets an httpOnly cookie with the session ID.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check if user already has a valid session cookie
    const existingSid = request.cookies.get(SESSION_COOKIE)?.value;
    if (existingSid) {
      const admin = getSupabaseAdmin();
      const { data: existing } = await admin
        .from('user_active_sessions')
        .select('id, is_active')
        .eq('id', existingSid)
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (existing) {
        // Session already registered and active — update last_seen
        await admin.from('user_active_sessions')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', existing.id);
        return NextResponse.json({ session_id: existing.id, status: 'existing' });
      }
    }

    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const deviceLabel = (body.device_label || request.headers.get('user-agent') || 'unknown').slice(0, 200);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') || 'unknown';

    // Count active sessions
    const { data: activeSessions } = await admin
      .from('user_active_sessions')
      .select('id, created_at, device_label')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    const active = activeSessions || [];
    let sessionsRevoked = 0;

    // Enforce MAX_SESSIONS — revoke oldest if at limit
    if (active.length >= MAX_SESSIONS) {
      const toRevoke = active.slice(0, active.length - MAX_SESSIONS + 1);
      for (const s of toRevoke) {
        await admin.from('user_active_sessions').update({
          is_active: false,
          revoked_at: new Date().toISOString(),
        }).eq('id', s.id);

        await admin.from('identity_events').insert({
          auth_user_id: user.id,
          event_type: 'session_revoked_by_limit',
          metadata: {
            revoked_session: s.id,
            device: s.device_label,
            reason: `Exceeded ${MAX_SESSIONS} device limit`,
          },
        });
        sessionsRevoked++;
      }
    }

    // Register new session
    const { data: newSession, error: insertErr } = await admin
      .from('user_active_sessions')
      .insert({
        auth_user_id: user.id,
        session_token_hash: 'sid-based', // Legacy column (NOT NULL), not used for lookups
        device_label: deviceLabel,
        ip_address: ip,
        user_agent: deviceLabel,
      })
      .select('id')
      .single();

    if (insertErr || !newSession) {
      console.error('[Session] Insert failed:', insertErr?.message);
      return NextResponse.json({ error: 'Failed to register session' }, { status: 500 });
    }

    // Log the identity event
    await admin.from('identity_events').insert({
      auth_user_id: user.id,
      event_type: 'session_registered',
      metadata: { session_id: newSession.id, device: deviceLabel, ip },
    });

    // Log to auth audit trail (best-effort)
    try {
      await admin.from('auth_audit_log').insert({
        auth_user_id: user.id,
        event_type: 'login_success',
        ip_address: ip,
        user_agent: deviceLabel,
        metadata: { session_id: newSession.id, sessions_revoked: sessionsRevoked },
      });
    } catch { /* best-effort */ }

    // Set the session cookie on the response
    const response = NextResponse.json({
      session_id: newSession.id,
      status: 'registered',
      sessions_revoked: sessionsRevoked,
    });

    response.cookies.set(SESSION_COOKIE, newSession.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch (err) {
    console.error('[Session] Registration error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE — Logout current session.
 *
 * Revokes the session identified by the cookie, clears the cookie.
 * Always returns 200 (even on errors) — logout should never fail visibly.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    const sessionId = request.cookies.get(SESSION_COOKIE)?.value;

    if (user && sessionId) {
      const admin = getSupabaseAdmin();
      await admin.from('user_active_sessions').update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      }).eq('id', sessionId).eq('auth_user_id', user.id);

      try {
        await admin.from('identity_events').insert({
          auth_user_id: user.id,
          event_type: 'session_logout',
          metadata: { session_id: sessionId },
        });
      } catch { /* best-effort */ }
    }

    const response = NextResponse.json({ status: 'logged_out' });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch {
    const response = NextResponse.json({ status: 'logged_out' });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
}

/**
 * GET — List sessions for the authenticated user.
 *
 * Returns up to 10 most recent sessions with a `is_current` flag
 * indicating which one matches the request cookie.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    const { data: sessions } = await admin
      .from('user_active_sessions')
      .select('id, device_label, created_at, last_seen_at, is_active, ip_address')
      .eq('auth_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const currentSid = request.cookies.get(SESSION_COOKIE)?.value;

    return NextResponse.json({
      sessions: (sessions || []).map(s => ({
        ...s,
        is_current: s.id === currentSid,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
