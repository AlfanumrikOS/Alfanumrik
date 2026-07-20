import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * POST /api/super-admin/logout — revoke the COOKIE session only, then expire
 * the sb-* cookies.
 *
 * 2026-07-20 RCA note (admin session split-brain): `signOut({ scope: 'local' })`
 * on the cookie-bound server client revokes exactly the session carried by the
 * httpOnly sb-* cookie. Post-fix, admin login never primes localStorage (the
 * login route returns no tokens and the login page no longer calls
 * setSession), so the cookie session is the ONLY session created by an admin
 * login and this revocation cannot reach anything else.
 *
 * Behavior matrix:
 * ┌────────────────────────────────────────────────┬──────────────────────────┐
 * │ Other session in the same browser              │ Effect of admin logout   │
 * ├────────────────────────────────────────────────┼──────────────────────────┤
 * │ Student/teacher localStorage session from a    │ UNTOUCHED — different    │
 * │ DIFFERENT login (own refresh-token family)     │ session; scope 'local'   │
 * │                                                │ only revokes the cookie  │
 * │                                                │ session                  │
 * │ Legacy localStorage copy primed by a PRE-fix   │ Revoked too — it shares  │
 * │ admin login (same refresh-token family as the  │ the cookie session.      │
 * │ cookie)                                        │ Acceptable transitional  │
 * │                                                │ behavior; disappears as  │
 * │                                                │ pre-fix copies age out   │
 * │ Admin sessions on OTHER devices/browsers       │ UNTOUCHED (scope 'local',│
 * │                                                │ never 'global')          │
 * └────────────────────────────────────────────────┴──────────────────────────┘
 *
 * The unconditional sb-* cookie sweep below only clears cookies on THIS
 * response — it cannot revoke any other session server-side.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-origin logout denied.' }, { status: 403 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });

  const response = NextResponse.json({ signedOut: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, {
          ...options,
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          ...(value ? {} : { maxAge: 0, expires: new Date(0) }),
        });
      }),
    },
  });

  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  for (const cookie of request.cookies.getAll()) {
    if (/^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name)) {
      response.cookies.set(cookie.name, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0, expires: new Date(0) });
    }
  }
  return response;
}
