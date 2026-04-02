/**
 * Email Confirmation Route
 *
 * Handles the token_hash + type flow for email verification.
 * Supabase sends two types of email links:
 *
 * 1. PKCE flow (code-based): /auth/callback?code=xxx
 * 2. Token hash flow: /auth/confirm?token_hash=xxx&type=signup
 *
 * This route handles the second case. Both must work.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get('token_hash');
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
  const SAFE_NEXT_PATTERN = /^\/[a-zA-Z0-9\-_/?.=&]+$/;
  const safeNext = (
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.includes('\\') &&
    !next.toLowerCase().includes('%2f') &&
    !next.toLowerCase().includes('javascript:') &&
    SAFE_NEXT_PATTERN.test(next)
  ) ? next : '/dashboard';

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
      return NextResponse.redirect(`${origin}${safeNext}`);
    }

    console.error('[Auth Confirm] Token verification failed:', error.message);
    return NextResponse.redirect(`${origin}/?error=verification_failed`);
  }

  // No token — redirect to login
  return NextResponse.redirect(`${origin}/`);
}
