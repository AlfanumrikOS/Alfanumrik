/**
 * ⚠️ CRITICAL AUTH PATH
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
 * Auth Callback Route — The Heart of Email-Based Auth
 *
 * Supabase PKCE flow (used since Supabase JS v2):
 * 1. User clicks email link (signup confirm, password reset, magic link)
 * 2. Link redirects to: /auth/callback?code=xxx&next=/dashboard
 * 3. THIS route exchanges the code for a session (server-side)
 * 4. Session is stored in cookies
 * 5. User is redirected to the `next` destination
 *
 * Without this route, ALL email-based auth flows break:
 * - Signup confirmation → user can't verify email
 * - Password reset → user gets "Invalid or Expired Link"
 * - Magic link login → link does nothing
 *
 * This is the #1 reason Indian students abandon the app at signup.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getRoleDestination, validateRedirectTarget } from '@/lib/identity';

// ── Session registration (2-device limit) ────────────────────────
const SESSION_COOKIE = 'alfanumrik_sid';
const MAX_SESSIONS = 2;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/**
 * Register a device session on the redirect response.
 * Fail-open: errors are logged but never block the auth flow.
 */
async function registerSessionOnResponse(
  response: NextResponse,
  userId: string,
  request: NextRequest
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const deviceLabel = (request.headers.get('user-agent') || 'unknown').slice(0, 200);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    // Enforce MAX_SESSIONS — revoke oldest if at limit
    const { data: active } = await admin
      .from('user_active_sessions')
      .select('id, created_at, device_label')
      .eq('auth_user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (active && active.length >= MAX_SESSIONS) {
      const toRevoke = active.slice(0, active.length - MAX_SESSIONS + 1);
      for (const s of toRevoke) {
        await admin.from('user_active_sessions').update({
          is_active: false, revoked_at: new Date().toISOString(),
        }).eq('id', s.id);
      }
    }

    const { data: newSession } = await admin
      .from('user_active_sessions')
      .insert({
        auth_user_id: userId,
        session_token_hash: 'sid-based', // Legacy NOT NULL column
        device_label: deviceLabel,
        ip_address: ip,
        user_agent: deviceLabel,
      })
      .select('id')
      .single();

    if (newSession) {
      response.cookies.set(SESSION_COOKIE, newSession.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_MAX_AGE,
      });
    }
  } catch (err) {
    console.error('[Callback] Session registration failed:', err instanceof Error ? err.message : err);
    // Non-blocking: don't break the auth flow
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  // Preserve whether `next` was explicitly provided. If not, we will resolve
  // a role-appropriate destination post-login (teacher → /teacher, etc.) to
  // avoid flashing the student dashboard to teachers/parents on magic-link
  // login. Falls back to /dashboard if role lookup fails (P15: Onboarding
  // Integrity — login must never break).
  const nextParam = searchParams.get('next');
  const next = nextParam ?? '/dashboard';
  const type = searchParams.get('type') ?? '';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Determine where to redirect based on the auth action type
      if (type === 'recovery') {
        // Password reset — pass session tokens via URL hash so the client-side
        // Supabase SDK picks them up via detectSessionInUrl. Without this, the
        // session lives only in server-side cookies and the browser client
        // (which uses localStorage) sees no session → "Invalid or Expired Link".
        const { data: { session: recoverySession } } = await supabase.auth.getSession();
        if (recoverySession) {
          const hashParams = new URLSearchParams({
            access_token: recoverySession.access_token,
            refresh_token: recoverySession.refresh_token,
            token_type: 'bearer',
            type: 'recovery',
          });
          return NextResponse.redirect(`${origin}/auth/reset#${hashParams.toString()}`);
        }
        return NextResponse.redirect(`${origin}/auth/reset`);
      }
      if (type === 'signup') {
        // Email confirmation — bootstrap profile (if not already done) then redirect
        // This handles the case where signup required email confirmation before
        // a session was available, so the client-side bootstrap couldn't run.
        //
        // WARNING: Do not remove the bootstrap call — it's the safety net for
        // users who confirmed their email after the session expired.
        let redirectRole = 'student';
        let signupUserId = '';
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            signupUserId = user.id;
            const meta = user.user_metadata || {};
            const email = user.email || '';
            const name = meta.name || email.split('@')[0];
            redirectRole = meta.role || 'student';

            // Check if profile already exists (bootstrap may have run during signup)
            const { data: existingStudent } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
            const { data: existingTeacher } = await supabase.from('teachers').select('id').eq('auth_user_id', user.id).single();
            const { data: existingGuardian } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();
            const { data: existingSchoolAdmin } = await supabase.from('school_admins').select('id').eq('auth_user_id', user.id).single();

            const hasProfile = !!(existingStudent || existingTeacher || existingGuardian || existingSchoolAdmin);

            if (!hasProfile) {
              if (redirectRole === 'institution_admin') {
                // Create school + school_admin rows using admin client.
                // The sync_school_admin_role trigger auto-assigns the institution_admin role.
                try {
                  const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
                  const admin = getSupabaseAdmin();
                  const { data: newSchool, error: schoolErr } = await admin
                    .from('schools')
                    .insert({
                      name: meta.school_name || 'My School',
                      city: meta.city || null,
                      state: meta.state || null,
                      board: meta.board || 'CBSE',
                    })
                    .select('id')
                    .single();
                  if (!schoolErr && newSchool) {
                    await admin.from('school_admins').insert({
                      auth_user_id: user.id,
                      school_id: newSchool.id,
                      name,
                      email,
                      phone: meta.phone || null,
                    });
                  } else if (schoolErr) {
                    console.error('[Auth Callback] School insert failed:', schoolErr.message);
                  }
                } catch (schoolBootstrapErr) {
                  console.error('[Auth Callback] School admin bootstrap failed:', schoolBootstrapErr);
                  // Non-fatal — admin can be set up manually
                }
              } else {
                // No profile exists — run server bootstrap via admin client
                try {
                  const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
                  const admin = getSupabaseAdmin();
                  await admin.rpc('bootstrap_user_profile', {
                    p_auth_user_id: user.id,
                    p_role: redirectRole,
                    p_name: name,
                    p_email: email,
                    p_grade: meta.grade || '9',
                    p_board: meta.board || 'CBSE',
                    p_school_name: meta.school_name || null,
                    p_subjects_taught: null,
                    p_grades_taught: null,
                    p_phone: null,
                    p_link_code: null,
                  });
                  // Re-query after bootstrap to confirm actual role from the DB.
                  // This handles the case where user_metadata.role is missing
                  // (e.g., teacher invited via link without role set in meta).
                  // Only override redirectRole if DB confirms a specific profile —
                  // if queries return null (network blip, test mock, etc.) we keep
                  // the meta.role value that was already set above.
                  const { data: postBootstrapTeacher } = await supabase.from('teachers').select('id').eq('auth_user_id', user.id).single();
                  const { data: postBootstrapGuardian } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();
                  if (postBootstrapTeacher) redirectRole = 'teacher';
                  else if (postBootstrapGuardian) redirectRole = 'parent';
                  // else: keep redirectRole as meta.role (already set at line above try block)
                } catch (bootstrapErr) {
                  console.error('[Auth Callback] Bootstrap failed:', bootstrapErr);
                  // Non-fatal — AuthContext fallback will retry, role stays as meta.role
                }
              }
            } else {
              // Detect actual role from existing profile (pre-bootstrap queries)
              if (existingSchoolAdmin) redirectRole = 'institution_admin';
              else if (existingTeacher) redirectRole = 'teacher';
              else if (existingGuardian) redirectRole = 'parent';
              else redirectRole = 'student';
            }

            // Fire-and-forget welcome email
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
            const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
            const { data: session } = await supabase.auth.getSession();
            const token = session?.session?.access_token;
            if (token && supabaseUrl) {
              const payload: Record<string, string> = { name, email, role: redirectRole };
              if (meta.grade) payload.grade = meta.grade;
              if (meta.board) payload.board = meta.board;
              fetch(`${supabaseUrl}/functions/v1/send-welcome-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': supabaseAnonKey },
                body: JSON.stringify(payload),
              }).catch((err: unknown) => {
                console.warn('[auth-callback] welcome email failed:', err instanceof Error ? err.message : String(err));
              }); // Best-effort
            }
          }
        } catch {
          // Bootstrap/email errors are non-fatal — always redirect
        }

        // Redirect based on role — register session on the response
        const signupResponse = NextResponse.redirect(`${origin}${getRoleDestination(redirectRole)}`);
        if (signupUserId) {
          await registerSessionOnResponse(signupResponse, signupUserId, request);
        }
        return signupResponse;
      }
      // Default: redirect to the `next` param if explicitly set, otherwise
      // '/dashboard' (the original pre-RBAC behavior). The role-aware default
      // redirect was disabled to fix an auth cookie propagation issue that
      // broke login for teacher/parent/admin/super_admin users. Client-side
      // AuthContext + per-page redirects handle role-specific routing once
      // the user lands on /dashboard.
      //
      // Validate `next` to prevent open redirect attacks:
      // - Must start with exactly one /
      // - Must not contain protocol-relative URLs (//), encoded slashes (%2f),
      //   backslashes, or javascript: URIs
      // - Only use trusted x-forwarded-host from Vercel (not arbitrary proxies)
      let defaultUserId: string | null = null;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) defaultUserId = user.id;
      } catch {
        // Non-blocking — fall through to default redirect
      }

      const safeNext = validateRedirectTarget(next, '/dashboard');

      // Only trust Vercel's forwarded host header (x-vercel-forwarded-host),
      // not the generic x-forwarded-host which can be spoofed by proxies
      const vercelHost = request.headers.get('x-vercel-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      let defaultRedirectUrl: string;
      if (isLocalEnv) {
        defaultRedirectUrl = `${origin}${safeNext}`;
      } else if (vercelHost) {
        defaultRedirectUrl = `https://${vercelHost}${safeNext}`;
      } else {
        defaultRedirectUrl = `${origin}${safeNext}`;
      }

      // Register session for default (non-signup, non-recovery) logins
      const defaultResponse = NextResponse.redirect(defaultRedirectUrl);
      if (defaultUserId) {
        try {
          await registerSessionOnResponse(defaultResponse, defaultUserId, request);
        } catch {
          // Non-blocking — session registration failure shouldn't break login
        }
      }
      return defaultResponse;
    }

    // Code exchange failed — redirect to login with error
    console.error('[Auth Callback] Code exchange failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // No code provided — redirect to login
  return NextResponse.redirect(`${origin}/login`);
}
