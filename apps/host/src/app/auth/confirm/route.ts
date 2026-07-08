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
 * Email Confirmation Route
 *
 * Handles the token_hash + type flow for email verification.
 * Supabase sends two types of email links:
 *
 * 1. PKCE flow (code-based): /auth/callback?code=xxx
 * 2. Token hash flow: /auth/confirm?token_hash=xxx&type=signup
 * 3. Legacy OTP token flow: /auth/confirm?token=xxx&email=user@example.com&type=signup
 *
 * This route handles the verification flows that land on /auth/confirm.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getRoleDestination, validateRedirectTarget } from '@alfanumrik/lib/identity';
import { profileParamsFromMetadata } from '@alfanumrik/lib/identity/bootstrap-profile';
import { bootstrapSchoolAdminProfile } from '@alfanumrik/lib/identity/school-admin-bootstrap';

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
    console.error('[Confirm] Session registration failed:', err instanceof Error ? err.message : err);
    // Non-blocking: don't break the auth flow
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get('token_hash');
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const type = searchParams.get('type') as 'signup' | 'recovery' | 'email' | 'invite' | null;
  const rawNext = searchParams.get('next') ?? '/dashboard';
  // next may be an absolute URL (e.g. https://alfanumrik.com/auth/callback?type=signup)
  // or a relative path (/dashboard). Ensure we only use the path portion with origin.
  let next = rawNext;
  if (rawNext.startsWith('http')) {
    try {
      const parsed = new URL(rawNext);
      next = parsed.pathname + parsed.search;
    } catch {
      next = '/dashboard';
    }
  }

  // Validate `next` to prevent open redirect attacks — same rules as /auth/callback.
  // Must start with exactly one /, no protocol-relative URLs, no backslashes,
  // no encoded slashes, no javascript: URIs.
  const safeNext = validateRedirectTarget(next, '/dashboard');

  if (token_hash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });

    if (!error) {
      if (type === 'recovery') {
        // Pass session tokens via URL hash so the client-side Supabase SDK
        // picks them up via detectSessionInUrl. Without this, the session
        // lives only in server-side cookies and the browser client (which
        // uses localStorage) sees no session → "Invalid or Expired Link".
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
        // Email confirmation for signup — bootstrap profile if needed, same as /auth/callback
        let redirectRole = 'student';
        let signupUserId = '';
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            signupUserId = user.id;
            // R2 (2026-06-10): single canonical metadata→params derivation
            // (shared with /auth/callback). Fixes teacher subjects_taught/
            // grades_taught previously dropped (passed null) on this route,
            // and the per-site grade default drift (now normalizeGrade — P5).
            const params = profileParamsFromMetadata(user);
            const email = params.email;
            const name = params.name;
            redirectRole = params.role;

            const { data: existingStudent } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
            const { data: existingTeacher } = await supabase.from('teachers').select('id').eq('auth_user_id', user.id).single();
            const { data: existingGuardian } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();
            const { data: existingSchoolAdmin } = await supabase.from('school_admins').select('id').eq('auth_user_id', user.id).single();
            const hasProfile = !!(existingStudent || existingTeacher || existingGuardian || existingSchoolAdmin);

            if (!hasProfile) {
              if (redirectRole === 'institution_admin') {
                // R2 (2026-06-10): token_hash-confirmed school-admin signups
                // previously landed WITHOUT a profile — this branch existed
                // only in /auth/callback. Shared helper creates the school +
                // school_admins rows; the sync_school_admin_role trigger
                // auto-assigns the institution_admin RBAC role.
                await bootstrapSchoolAdminProfile(
                  {
                    authUserId: user.id,
                    name,
                    email,
                    schoolName: params.school_name,
                    city: params.school_city,
                    state: params.school_state,
                    board: params.board,
                    phone: params.phone,
                  },
                  '[Auth Confirm]'
                );
              } else {
                try {
                  const { getSupabaseAdmin } = await import('@alfanumrik/lib/supabase-admin');
                  const admin = getSupabaseAdmin();
                  await admin.rpc('bootstrap_user_profile', {
                    p_auth_user_id: user.id,
                    p_role: redirectRole,
                    p_name: name,
                    p_email: email,
                    p_grade: params.grade,
                    p_board: params.board,
                    p_school_name: params.school_name,
                    p_subjects_taught: params.subjects,
                    p_grades_taught: params.grades_taught,
                    p_phone: params.phone,
                    p_link_code: params.link_code,
                  });
                } catch (bootstrapErr) {
                  console.error('[Auth Confirm] Bootstrap failed:', bootstrapErr);
                }
              }
            } else {
              if (existingSchoolAdmin) redirectRole = 'institution_admin';
              else if (existingTeacher) redirectRole = 'teacher';
              else if (existingGuardian) redirectRole = 'parent';
              else redirectRole = 'student';
            }
          }
        } catch { /* Non-fatal */ }

        const signupResponse = NextResponse.redirect(`${origin}${getRoleDestination(redirectRole)}`);
        if (signupUserId) {
          await registerSessionOnResponse(signupResponse, signupUserId, request);
        }
        return signupResponse;
      }

      // Default (non-signup, non-recovery) — register session
      const defaultResponse = NextResponse.redirect(`${origin}${safeNext}`);
      try {
        const { data: { user: defaultUser } } = await supabase.auth.getUser();
        if (defaultUser) {
          await registerSessionOnResponse(defaultResponse, defaultUser.id, request);
        }
      } catch {
        // Non-blocking — session registration failure shouldn't break login
      }
      return defaultResponse;
    }

    console.error('[Auth Confirm] Token verification failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=verification_failed`);
  }

  if (token && email && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token, email, type });

    if (!error) {
      if (type === 'recovery') {
        // Pass session tokens via URL hash so the client-side Supabase SDK
        // picks them up via detectSessionInUrl. Without this, the session
        // lives only in server-side cookies and the browser client (which
        // uses localStorage) sees no session → "Invalid or Expired Link".
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
        // Email confirmation for signup — bootstrap profile if needed, same as /auth/callback
        let redirectRole = 'student';
        let signupUserId = '';
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            signupUserId = user.id;
            // R2 (2026-06-10): single canonical metadata→params derivation
            // (shared with /auth/callback). Fixes teacher subjects_taught/
            // grades_taught previously dropped (passed null) on this route,
            // and the per-site grade default drift (now normalizeGrade — P5).
            const params = profileParamsFromMetadata(user);
            const email = params.email;
            const name = params.name;
            redirectRole = params.role;

            const { data: existingStudent } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
            const { data: existingTeacher } = await supabase.from('teachers').select('id').eq('auth_user_id', user.id).single();
            const { data: existingGuardian } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();
            const { data: existingSchoolAdmin } = await supabase.from('school_admins').select('id').eq('auth_user_id', user.id).single();
            const hasProfile = !!(existingStudent || existingTeacher || existingGuardian || existingSchoolAdmin);

            if (!hasProfile) {
              if (redirectRole === 'institution_admin') {
                // R2 (2026-06-10): token_hash-confirmed school-admin signups
                // previously landed WITHOUT a profile — this branch existed
                // only in /auth/callback. Shared helper creates the school +
                // school_admins rows; the sync_school_admin_role trigger
                // auto-assigns the institution_admin RBAC role.
                await bootstrapSchoolAdminProfile(
                  {
                    authUserId: user.id,
                    name,
                    email,
                    schoolName: params.school_name,
                    city: params.school_city,
                    state: params.school_state,
                    board: params.board,
                    phone: params.phone,
                  },
                  '[Auth Confirm]'
                );
              } else {
                try {
                  const { getSupabaseAdmin } = await import('@alfanumrik/lib/supabase-admin');
                  const admin = getSupabaseAdmin();
                  await admin.rpc('bootstrap_user_profile', {
                    p_auth_user_id: user.id,
                    p_role: redirectRole,
                    p_name: name,
                    p_email: email,
                    p_grade: params.grade,
                    p_board: params.board,
                    p_school_name: params.school_name,
                    p_subjects_taught: params.subjects,
                    p_grades_taught: params.grades_taught,
                    p_phone: params.phone,
                    p_link_code: params.link_code,
                  });
                } catch (bootstrapErr) {
                  console.error('[Auth Confirm] Bootstrap failed:', bootstrapErr);
                }
              }
            } else {
              if (existingSchoolAdmin) redirectRole = 'institution_admin';
              else if (existingTeacher) redirectRole = 'teacher';
              else if (existingGuardian) redirectRole = 'parent';
              else redirectRole = 'student';
            }
          }
        } catch { /* Non-fatal */ }

        const signupResponse = NextResponse.redirect(`${origin}${getRoleDestination(redirectRole)}`);
        if (signupUserId) {
          await registerSessionOnResponse(signupResponse, signupUserId, request);
        }
        return signupResponse;
      }

      // Default (non-signup, non-recovery) — register session
      const defaultResponse = NextResponse.redirect(`${origin}${safeNext}`);
      try {
        const { data: { user: defaultUser } } = await supabase.auth.getUser();
        if (defaultUser) {
          await registerSessionOnResponse(defaultResponse, defaultUser.id, request);
        }
      } catch {
        // Non-blocking — session registration failure shouldn't break login
      }
      return defaultResponse;
    }

    console.error('[Auth Confirm] Token verification failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=verification_failed`);
  }

  // No token — redirect to login
  return NextResponse.redirect(`${origin}/login`);
}
