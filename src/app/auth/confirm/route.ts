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
  const next = searchParams.get('next') ?? '/dashboard';

  if (token_hash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });

    if (!error) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/auth/reset`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error('[Auth Confirm] Token verification failed:', error.message);
    return NextResponse.redirect(`${origin}/?error=verification_failed`);
  }

  // No token — redirect to login
  return NextResponse.redirect(`${origin}/`);
}
