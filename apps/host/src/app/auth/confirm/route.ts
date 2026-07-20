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
import { getRoleDestination, validateRedirectTarget } from '@alfanumrik/lib/identity';
import {
  completeSignupBootstrap,
  registerSessionOnResponse,
} from '@alfanumrik/lib/identity/complete-signup';

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
      if (type === 'invite') {
        // Supabase-Dashboard-invited users (type=invite) must set a password
        // before they can use the account — there is no existing password to
        // log in with. Route to the SAME /auth/reset flow as 'recovery': that
        // page only cares that a live session exists and calls
        // supabase.auth.updateUser({ password }); it does not care WHY the
        // user needs to set one. Falling through to the generic default
        // branch below would silently register a session and drop the user
        // on /dashboard with no way to ever set a password.
        // P15 gap fixed 2026-07-20 — see admin-user-invite-flow incident.
        const { data: { session: inviteSession } } = await supabase.auth.getSession();
        if (inviteSession) {
          const hashParams = new URLSearchParams({
            access_token: inviteSession.access_token,
            refresh_token: inviteSession.refresh_token,
            token_type: 'bearer',
            type: 'invite',
          });
          return NextResponse.redirect(`${origin}/auth/reset#${hashParams.toString()}`);
        }
        return NextResponse.redirect(`${origin}/auth/reset`);
      }
      if (type === 'signup') {
        // Email confirmation for signup — unified bootstrap (profile-existence
        // probe → institution_admin/RPC branch → role re-detection → welcome
        // email) shared with /auth/callback via completeSignupBootstrap. This
        // closes the prior drift where token_hash-confirmed school-admin signups
        // landed WITHOUT a profile. P15: never throws — always redirects below.
        let redirectRole = 'student';
        let signupUserId = '';
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            signupUserId = user.id;
            redirectRole = await completeSignupBootstrap(supabase, user);
          }
        } catch { /* Non-fatal */ }

        const signupResponse = NextResponse.redirect(`${origin}${getRoleDestination(redirectRole)}`);
        if (signupUserId) {
          await registerSessionOnResponse(signupResponse, signupUserId, request);
        }
        return signupResponse;
      }

      // Default (non-signup, non-recovery, non-invite) — register session
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
      if (type === 'invite') {
        // Supabase-Dashboard-invited users (type=invite) must set a password
        // before they can use the account — there is no existing password to
        // log in with. Route to the SAME /auth/reset flow as 'recovery': that
        // page only cares that a live session exists and calls
        // supabase.auth.updateUser({ password }); it does not care WHY the
        // user needs to set one. Falling through to the generic default
        // branch below would silently register a session and drop the user
        // on /dashboard with no way to ever set a password.
        // P15 gap fixed 2026-07-20 — see admin-user-invite-flow incident.
        // Legacy token+email+type flow mirror of the token_hash branch above.
        const { data: { session: inviteSession } } = await supabase.auth.getSession();
        if (inviteSession) {
          const hashParams = new URLSearchParams({
            access_token: inviteSession.access_token,
            refresh_token: inviteSession.refresh_token,
            token_type: 'bearer',
            type: 'invite',
          });
          return NextResponse.redirect(`${origin}/auth/reset#${hashParams.toString()}`);
        }
        return NextResponse.redirect(`${origin}/auth/reset`);
      }
      if (type === 'signup') {
        // Email confirmation for signup — unified bootstrap (profile-existence
        // probe → institution_admin/RPC branch → role re-detection → welcome
        // email) shared with /auth/callback via completeSignupBootstrap. This
        // closes the prior drift where token_hash-confirmed school-admin signups
        // landed WITHOUT a profile. P15: never throws — always redirects below.
        let redirectRole = 'student';
        let signupUserId = '';
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            signupUserId = user.id;
            redirectRole = await completeSignupBootstrap(supabase, user);
          }
        } catch { /* Non-fatal */ }

        const signupResponse = NextResponse.redirect(`${origin}${getRoleDestination(redirectRole)}`);
        if (signupUserId) {
          await registerSessionOnResponse(signupResponse, signupUserId, request);
        }
        return signupResponse;
      }

      // Default (non-signup, non-recovery, non-invite) — register session
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
