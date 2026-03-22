import { NextResponse, type NextRequest } from 'next/server';

/* ═══════════════════════════════════════════════════════════════
 * MIDDLEWARE — Security & request validation
 *
 * NOTE: Auth protection is handled CLIENT-SIDE via AuthContext.
 * Supabase JS v2 stores auth tokens in localStorage (not cookies),
 * so server-side cookie checks cannot detect logged-in users.
 * Each page uses useAuth() guards to redirect unauthenticated users.
 * ═══════════════════════════════════════════════════════════════ */

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add request ID for tracing
  const requestId = crypto.randomUUID();
  response.headers.set('X-Request-Id', requestId);

  // Block common bot/scanner paths early
  const path = request.nextUrl.pathname;
  if (
    path.startsWith('/wp-') ||
    path.startsWith('/phpmy') ||
    path.endsWith('.php') ||
    path.endsWith('.env') ||
    path.startsWith('/.git')
  ) {
    return new NextResponse(null, { status: 404 });
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
