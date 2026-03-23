import { NextResponse, type NextRequest } from 'next/server';

/* ═══════════════════════════════════════════════════════════════
 * MIDDLEWARE — Security Hardening Layer
 *
 * Dario's principle: Defense in depth. Every layer assumes the
 * layer below it might be compromised.
 *
 * Layer 1: Security headers (XSS, clickjacking, MIME sniffing)
 * Layer 2: Bot/scanner blocking
 * Layer 3: API rate limiting (IP-based, in-memory with fallback)
 * Layer 4: Request validation
 *
 * NOTE: Auth protection is handled CLIENT-SIDE via AuthContext +
 * Supabase RLS as the server-side enforcement layer.
 * Supabase JS v2 stores auth tokens in localStorage (not cookies),
 * so server-side cookie checks cannot detect logged-in users.
 * RLS policies in PostgreSQL are the true auth boundary.
 * ═══════════════════════════════════════════════════════════════ */

// ── In-memory rate limiter for API-like routes ──
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60;        // 60 requests per minute per IP
const RATE_LIMIT_PARENT_MAX = 5;  // 5 parent login attempts per minute per IP

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return ip;
}

function checkRateLimit(key: string, max: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: max - 1 };
  }

  entry.count++;
  if (entry.count > max) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: max - entry.count };
}

// Clean up stale entries every 5 minutes
if (typeof globalThis !== 'undefined') {
  const cleanup = () => {
    const now = Date.now();
    rateLimitMap.forEach((entry, key) => {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    });
  };
  // Use setInterval only in Node.js runtime
  if (typeof setInterval !== 'undefined') {
    setInterval(cleanup, 5 * 60_000);
  }
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── Layer 2: Block common bot/scanner paths early ──
  if (
    path.startsWith('/wp-') ||
    path.startsWith('/phpmy') ||
    path.endsWith('.php') ||
    path.endsWith('.env') ||
    path.startsWith('/.git') ||
    path.startsWith('/admin') ||
    path.startsWith('/cgi-bin') ||
    path.includes('..') // Path traversal attempt
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // ── Layer 3: Rate limiting for sensitive routes ──
  const ip = getRateLimitKey(request);

  // Stricter rate limit for parent portal (brute-force protection)
  if (path === '/parent' || path.startsWith('/parent/')) {
    const { allowed, remaining } = checkRateLimit(`parent:${ip}`, RATE_LIMIT_PARENT_MAX);
    if (!allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many attempts. Please wait 1 minute.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Remaining', String(remaining));
    return addSecurityHeaders(response, request);
  }

  // General rate limit for all routes
  const { allowed } = checkRateLimit(`general:${ip}`, RATE_LIMIT_MAX);
  if (!allowed) {
    return new NextResponse(
      JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      }
    );
  }

  const response = NextResponse.next();
  return addSecurityHeaders(response, request);
}

function addSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  // ── Layer 1: Security Headers ──

  // Request ID for tracing
  const requestId = crypto.randomUUID();
  response.headers.set('X-Request-Id', requestId);

  // Prevent clickjacking — no one should iframe Alfanumrik
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy — don't leak URLs to third parties
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy — restrict sensitive APIs
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  // HSTS — force HTTPS (1 year, include subdomains)
  if (request.nextUrl.protocol === 'https:') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/).*)',
  ],
};
