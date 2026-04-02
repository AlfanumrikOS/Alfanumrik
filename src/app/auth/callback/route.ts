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
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const meta = user.user_metadata || {};
            const email = user.email || '';
            const name = meta.name || email.split('@')[0];
            redirectRole = meta.role || 'student';

            // Check if profile already exists (bootstrap may have run during signup)
            const { data: existingStudent } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
            const { data: existingTeacher } = await supabase.from('teachers').select('id').eq('auth_user_id', user.id).single();
            const { data: existingGuardian } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();

            const hasProfile = !!(existingStudent || existingTeacher || existingGuardian);

            if (!hasProfile) {
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
              } catch (bootstrapErr) {
                console.error('[Auth Callback] Bootstrap failed:', bootstrapErr);
                // Non-fatal — AuthContext fallback will retry
              }
            } else {
              // Detect actual role from existing profile
              if (existingTeacher) redirectRole = 'teacher';
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
              }).catch(() => {}); // Best-effort
            }
          }
        } catch {
          // Bootstrap/email errors are non-fatal — always redirect
        }

        // Redirect based on role
        if (redirectRole === 'teacher') return NextResponse.redirect(`${origin}/teacher`);
        if (redirectRole === 'parent') return NextResponse.redirect(`${origin}/parent`);
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
