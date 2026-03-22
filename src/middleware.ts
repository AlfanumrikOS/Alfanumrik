import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

/* ═══════════════════════════════════════════════════════════════
 * ROUTE PROTECTION MIDDLEWARE
 * - Redirects unauthenticated users away from protected routes
 * - Allows public routes (landing, auth, help, api)
 * - Lightweight: only checks Supabase session token existence
 * ═══════════════════════════════════════════════════════════════ */

const PUBLIC_ROUTES = new Set(['/', '/auth/reset', '/help']);
const PUBLIC_PREFIXES = ['/api/', '/_next/', '/favicon', '/manifest', '/sw.js', '/icons/'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public assets and API routes
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Skip exact public routes
  if (PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  // Check for Supabase auth tokens in cookies
  const sbAccessToken =
    request.cookies.get('sb-access-token')?.value ??
    request.cookies.get(`sb-${getProjectRef()}-auth-token`)?.value;

  // Also check the newer cookie format (sb-<ref>-auth-token.0 etc)
  const hasAuthCookie = sbAccessToken || Array.from(request.cookies.getAll()).some(
    c => c.name.includes('auth-token') && c.value
  );

  if (!hasAuthCookie) {
    // Allow parent and admin pages (they have their own auth)
    if (pathname === '/parent' || pathname === '/admin') {
      return NextResponse.next();
    }

    // Redirect to landing page for unauthenticated users
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

function getProjectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const match = url.match(/https?:\/\/([^.]+)/);
  return match?.[1] || '';
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
