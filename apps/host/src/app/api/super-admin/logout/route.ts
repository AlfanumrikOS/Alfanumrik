import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
