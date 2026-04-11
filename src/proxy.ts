import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ⚠️ CRITICAL AUTH PATH — DO NOT MODIFY without testing login/signup/reset flows
/* ═══════════════════════════════════════════════════════════════
 * PROXY — Security Hardening + Auth Session Refresh
 * Entry point: src/middleware.ts (re-exports this file for Next.js convention)
 *
 * Defense in depth. Every layer assumes the layer below might be
 * compromised.
 *
 * Layer 0: Supabase session refresh (keeps auth cookies fresh)
 * Layer 1: Security headers (XSS, clickjacking, MIME sniffing)
 * Layer 2: Bot/scanner blocking
 * Layer 3: Distributed rate limiting (Upstash Redis, falls back to in-memory)
 * Layer 4: Request validation
 *
 * RLS policies in PostgreSQL remain the true auth boundary.
 * ═══════════════════════════════════════════════════════════════ */

// ── Rate limiting: Distributed (Upstash Redis) with in-memory fallback ──
const RATE_LIMIT_MAX = 200;       // 200 requests per minute per IP (each page load = 5-8 API calls)
const RATE_LIMIT_PARENT_MAX = 20; // 20 parent requests per minute per IP
const RATE_LIMIT_ADMIN_MAX = 60;  // 60 requests per minute for /internal/admin/*

// Distributed rate limiter via Upstash Redis (works across all Vercel instances)
let redisRateLimiter: Ratelimit | null = null;
let redisParentLimiter: Ratelimit | null = null;
let redisAdminLimiter: Ratelimit | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    redisRateLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, '1 m'), prefix: 'rl:general' });
    redisParentLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(RATE_LIMIT_PARENT_MAX, '1 m'), prefix: 'rl:parent' });
    redisAdminLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(RATE_LIMIT_ADMIN_MAX, '1 m'), prefix: 'rl:admin' });
  }
} catch {
  // Redis initialization failed (invalid URL, etc.) — fall back to in-memory
  redisRateLimiter = null;
  redisParentLimiter = null;
  redisAdminLimiter = null;
}

// In-memory fallback if Upstash not configured
const MAX_MAP_SIZE = 10_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;

function getRateLimitKey(request: NextRequest): string {
  return (
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkRateLimitLocal(key: string, max: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    if (rateLimitMap.size >= MAX_MAP_SIZE) {
      const firstKey = rateLimitMap.keys().next().value;
      if (firstKey) rateLimitMap.delete(firstKey);
    }
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: max - 1 };
  }
  entry.count++;
  if (entry.count > max) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: max - entry.count };
}

async function checkRateLimit(key: string, max: number, type: 'general' | 'parent' | 'admin' = 'general'): Promise<{ allowed: boolean; remaining: number }> {
  const limiter = type === 'parent' ? redisParentLimiter : type === 'admin' ? redisAdminLimiter : redisRateLimiter;
  if (limiter) {
    try {
      const result = await limiter.limit(key);
      return { allowed: result.success, remaining: result.remaining };
    } catch {
      // Redis unavailable — fall back to in-memory
      return checkRateLimitLocal(key, max);
    }
  }
  return checkRateLimitLocal(key, max);
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const pathname = path; // alias for clarity in API checks

  // ── CORS: Allowed origins (not wildcard) ──
  const ALLOWED_ORIGINS = [
    'https://alfanumrik.com',
    'https://www.alfanumrik.com',
    'https://alfanumrik.vercel.app',
    'https://alfanumrik-ten.vercel.app',
  ];
  if (process.env.NODE_ENV !== 'production') {
    ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:3001');
  }

  const origin = request.headers.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  // ── Layer 0.5: API Authentication Check ──
  if (pathname.startsWith('/api/v1/')) {
    // Health endpoint is public (no auth required, used by monitors)
    const isHealthCheck = pathname === '/api/v1/health';

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-request-id',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        },
      });
    }

    // Check for Authorization header or valid session cookie (skip for health)
    if (!isHealthCheck) {
      const authHeader = request.headers.get('Authorization');
      // Match Supabase auth cookie names exactly (sb-<ref>-auth-token / sb-<ref>-auth-token.0 etc.)
      const hasSession = request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name));

      if (!authHeader && !hasSession) {
        return NextResponse.json(
          { error: 'Authentication required', code: 'AUTH_REQUIRED' },
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  // ── Layer 0.6: Protected page routes (require Supabase session) ──
  const PROTECTED_PREFIXES = ['/parent/children', '/parent/reports', '/parent/profile', '/parent/support'];
  if (PROTECTED_PREFIXES.some(p => path.startsWith(p))) {
    const hasSession = request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name));
    if (!hasSession) {
      const loginUrl = new URL('/parent', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── Layer 0.7: School admin portal — require Supabase session ──
  // Role verification (institution_admin check) is performed client-side via
  // school_admins table query (RLS-enforced). Middleware only blocks unauthenticated access.
  if (path.startsWith('/school-admin')) {
    const hasSession = request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name));
    if (!hasSession) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', path);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── Layer 0: Supabase session refresh ──
  // This keeps the auth cookie fresh on every request.
  // Required for the PKCE email flow (signup confirm, password reset).
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });
    // Refresh the session — this extends the cookie expiry
    await supabase.auth.getUser();
  }

  // ── Layer 2: Block common bot/scanner paths early ──
  if (
    path.startsWith('/wp-') ||
    path.startsWith('/phpmy') ||
    path.endsWith('.php') ||
    path.endsWith('.env') ||
    path.startsWith('/.git') ||
    (path.startsWith('/admin') && !path.startsWith('/internal/admin')) ||
    path.startsWith('/cgi-bin') ||
    path.includes('..') // Path traversal attempt
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // ── Layer 2.1: Protect ALL /internal/admin routes (page + API) ──
  // Server-side auth: secret must match BEFORE page or API renders.
  //
  // Auth flow (two accepted mechanisms):
  //   1. x-admin-secret header      — used by all API calls (adminHeaders() in admin-session.ts)
  //   2. ?secret= query param       — ONLY for first page load; immediately stripped from URL
  //                                   and stored as a short-lived httpOnly session cookie so
  //                                   the secret never persists in browser history or server logs.
  //   3. alfanumrik_admin_sess cookie — set by mechanism 2; used for subsequent page loads.
  //
  // Security property: after the first redirect, the secret no longer appears in any URL.
  const ADMIN_SESSION_COOKIE = 'alfanumrik_admin_sess';
  const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60; // 8 hours

  if (path.startsWith('/internal/admin') || path.startsWith('/api/internal/admin')) {
    const secretKey = process.env.SUPER_ADMIN_SECRET;

    // Header-based auth (API calls + already-authenticated page requests)
    const headerSecret = request.headers.get('x-admin-secret');

    // Query-param auth (first-time page navigation only — strip immediately after validation)
    const querySecret = request.nextUrl.searchParams.get('secret');

    // Cookie-based auth (subsequent page loads after first redirect)
    const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    // Cookie stores sha256(secretKey + "|admin_session") — validates without putting the raw
    // secret in the cookie value. Uses Web Crypto (globalThis.crypto.subtle) for Edge compat.
    let expectedCookieToken: string | null = null;
    if (secretKey) {
      const enc = new TextEncoder();
      const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(`${secretKey}|admin_session`));
      expectedCookieToken = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32);
    }
    const cookieValid = !!(sessionCookie && expectedCookieToken && sessionCookie === expectedCookieToken);

    const headerValid = !!(headerSecret && secretKey && headerSecret === secretKey);
    const queryValid  = !!(querySecret  && secretKey && querySecret  === secretKey);

    const isAuthenticated = headerValid || cookieValid || queryValid;

    if (!secretKey || !isAuthenticated) {
      if (path.startsWith('/api/')) {
        return new NextResponse(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new NextResponse(
        '<html><body style="background:#0f0f0f;color:#e0e0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:48px;margin-bottom:16px">🔐</div><h1 style="font-size:18px;margin-bottom:8px">Access Denied</h1><p style="color:#888;font-size:13px">Invalid or missing admin secret.</p></div></body></html>',
        { status: 401, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // If authenticated via query param on a page route: redirect to clean URL + set session cookie.
    // This strips the secret from the URL so it never sits in browser history or CDN logs.
    if (queryValid && !path.startsWith('/api/')) {
      const cleanUrl = new URL(request.url);
      cleanUrl.searchParams.delete('secret');
      const redirectRes = NextResponse.redirect(cleanUrl, { status: 302 });
      redirectRes.cookies.set(ADMIN_SESSION_COOKIE, expectedCookieToken!, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: ADMIN_SESSION_MAX_AGE,
        path: '/internal/admin',
      });
      return redirectRes;
    }

    // Rate limit: 10 requests/minute for admin routes
    const adminIp = getRateLimitKey(request);
    const { allowed: adminAllowed } = await checkRateLimit(`admin:${adminIp}`, RATE_LIMIT_ADMIN_MAX, 'admin');
    if (!adminAllowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        }
      );
    }
  }

  // ── Layer 2.5: Redirect unauthenticated visitors from / to /welcome ──
  // Done in middleware to avoid client-side flash (page loads then redirects)
  if (path === '/') {
    const hasSession = request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name));
    if (!hasSession) {
      return NextResponse.redirect(new URL('/welcome', request.url));
    }
  }

  // ── Layer 3: Rate limiting for sensitive routes ──
  const ip = getRateLimitKey(request);

  // Stricter rate limit for parent portal (brute-force protection)
  if (path === '/parent' || path.startsWith('/parent/')) {
    const { allowed, remaining } = await checkRateLimit(`parent:${ip}`, RATE_LIMIT_PARENT_MAX, 'parent');
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

    response.headers.set('X-RateLimit-Remaining', String(remaining));
    return addSecurityHeaders(response, request);
  }

  // Exempt health endpoint from rate limiting (used by uptime monitors)
  if (pathname === '/api/v1/health') {
    return addSecurityHeaders(response, request);
  }

  // General rate limit for all routes
  const { allowed, remaining: generalRemaining } = await checkRateLimit(`general:${ip}`, RATE_LIMIT_MAX, 'general');
  if (!allowed) {
    return new NextResponse(
      JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      }
    );
  }

  // Add rate limit + security headers for API routes
  if (pathname.startsWith('/api/v1/') || pathname.startsWith('/api/')) {
    response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
    response.headers.set('X-RateLimit-Remaining', String(generalRemaining));

    // Prevent CDN/browser from caching API responses (personalized data)
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');

    // Add CORS headers for API routes (origin-checked, not wildcard)
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-request-id');
    response.headers.set('Vary', 'Origin');
  }

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

// Alias for backward-compatibility with test imports (import('@/proxy').middleware)
export { proxy as middleware };
