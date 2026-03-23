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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';
  const type = searchParams.get('type') ?? '';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Determine where to redirect based on the auth action type
      if (type === 'recovery') {
        // Password reset — redirect to the reset form
        return NextResponse.redirect(`${origin}/auth/reset`);
      }
      if (type === 'signup') {
        // Email confirmation — redirect to dashboard
        return NextResponse.redirect(`${origin}/dashboard`);
      }
      // Default: redirect to the `next` param or dashboard
      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }

    // Code exchange failed — redirect to login with error
    console.error('[Auth Callback] Code exchange failed:', error.message);
    return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
  }

  // No code provided — redirect to login
  return NextResponse.redirect(`${origin}/`);
}
