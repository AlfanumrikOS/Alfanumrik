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
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getRoleDestination, validateRedirectTarget } from '@alfanumrik/lib/identity';
import {
  completeSignupBootstrap,
  registerSessionOnResponse,
} from '@alfanumrik/lib/identity/complete-signup';

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
        // Email confirmation — bootstrap profile (if not already done) then redirect.
        // This handles the case where signup required email confirmation before
        // a session was available, so the client-side bootstrap couldn't run.
        //
        // The profile-existence probe → institution_admin/RPC branch → role
        // re-detection → welcome email are now unified in completeSignupBootstrap
        // (shared with /auth/confirm). Do not inline that logic here again.
        //
        // P15: getUser + completeSignupBootstrap are wrapped so a thrown lookup
        // never breaks the funnel — we always redirect below.
        let redirectRole = 'student';
        let signupUserId = '';
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            signupUserId = user.id;
            redirectRole = await completeSignupBootstrap(supabase, user);
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

      // Validate vercelHost domain to prevent open redirect vulnerabilities
      let isAllowedHost = false;
      if (vercelHost) {
        const hostLower = vercelHost.toLowerCase().trim();
        if (
          hostLower === 'alfanumrik.in' ||
          hostLower.endsWith('.alfanumrik.in') ||
          hostLower.endsWith('.vercel.app') ||
          hostLower.startsWith('localhost:') ||
          hostLower === 'localhost'
        ) {
          isAllowedHost = true;
        }
      }

      let defaultRedirectUrl: string;
      if (isLocalEnv) {
        defaultRedirectUrl = `${origin}${safeNext}`;
      } else if (vercelHost && isAllowedHost) {
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
