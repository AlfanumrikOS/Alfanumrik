import { NextResponse, type NextRequest } from 'next/server';

/* ═══════════════════════════════════════════════════════════════
 * MIDDLEWARE — Security headers & routing
 *
 * NOTE: Auth protection is handled CLIENT-SIDE via AuthContext.
 * Supabase JS v2 stores auth tokens in localStorage (not cookies),
 * so server-side cookie checks cannot detect logged-in users.
 * Each page uses useAuth() guards to redirect unauthenticated users.
 * ═══════════════════════════════════════════════════════════════ */

export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
