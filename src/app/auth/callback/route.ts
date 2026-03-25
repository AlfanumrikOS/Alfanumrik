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
        // Email confirmation — send welcome email then redirect to dashboard
        // Fire-and-forget: fetch user metadata and trigger welcome email
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const meta = user.user_metadata || {};
            const email = user.email || '';
            const name = meta.name || email.split('@')[0];

            // Determine role from profile tables
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
            const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
            const { data: session } = await supabase.auth.getSession();
            const token = session?.session?.access_token;

            if (token && supabaseUrl) {
              // Check which profile exists to determine role
              const { data: studentData } = await supabase.from('students').select('grade, board').eq('auth_user_id', user.id).single();
              const { data: teacherData } = await supabase.from('teachers').select('school_name').eq('auth_user_id', user.id).single();
              const { data: guardianData } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();

              let role = 'student';
              const payload: Record<string, string> = { name, email };
              if (studentData) {
                role = 'student';
                payload.grade = studentData.grade?.replace('Grade ', '') || '';
                payload.board = studentData.board || '';
              } else if (teacherData) {
                role = 'teacher';
                payload.school_name = teacherData.school_name || '';
              } else if (guardianData) {
                role = 'parent';
              }
              payload.role = role;

              fetch(`${supabaseUrl}/functions/v1/send-welcome-email`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                  'apikey': supabaseAnonKey,
                },
                body: JSON.stringify(payload),
              }).catch(() => {}); // Best-effort, don't block redirect
            }
          }
        } catch {
          // Welcome email is best-effort — never block signup confirmation
        }
        // Redirect based on role
        try {
          const { data: { user: u2 } } = await supabase.auth.getUser();
          if (u2) {
            const metaRole = u2.user_metadata?.role;
            if (metaRole === 'teacher') return NextResponse.redirect(`${origin}/teacher`);
            if (metaRole === 'parent') return NextResponse.redirect(`${origin}/parent`);
            // Check DB tables as fallback
            const { data: gd } = await supabase.from('guardians').select('id').eq('auth_user_id', u2.id).single();
            if (gd) return NextResponse.redirect(`${origin}/parent`);
            const { data: td } = await supabase.from('teachers').select('id').eq('auth_user_id', u2.id).single();
            if (td) return NextResponse.redirect(`${origin}/teacher`);
          }
        } catch { /* fallback to /dashboard */ }
        return NextResponse.redirect(`${origin}/dashboard`);
      }
      // Default: redirect to the `next` param or dashboard
      // Validate `next` to prevent open redirect attacks:
      // - Must start with exactly one /
      // - Must not contain protocol-relative URLs (//), encoded slashes (%2f),
      //   backslashes, or javascript: URIs
      // - Only use trusted x-forwarded-host from Vercel (not arbitrary proxies)
      const SAFE_NEXT_PATTERN = /^\/[a-zA-Z0-9\-_/?.=&]+$/;
      const safeNext = (
        next.startsWith('/') &&
        !next.startsWith('//') &&
        !next.includes('\\') &&
        !next.toLowerCase().includes('%2f') &&
        !next.toLowerCase().includes('javascript:') &&
        SAFE_NEXT_PATTERN.test(next)
      ) ? next : '/dashboard';

      // Only trust Vercel's forwarded host header (x-vercel-forwarded-host),
      // not the generic x-forwarded-host which can be spoofed by proxies
      const vercelHost = request.headers.get('x-vercel-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${safeNext}`);
      } else if (vercelHost) {
        return NextResponse.redirect(`https://${vercelHost}${safeNext}`);
      } else {
        return NextResponse.redirect(`${origin}${safeNext}`);
      }
    }

    // Code exchange failed — redirect to login with error
    console.error('[Auth Callback] Code exchange failed:', error.message);
    return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
  }

  // No code provided — redirect to login
  return NextResponse.redirect(`${origin}/`);
}
