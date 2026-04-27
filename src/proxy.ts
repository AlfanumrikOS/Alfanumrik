/**
 * ⚠️ CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break login/signup/verify/reset for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Run: node scripts/auth-guard.js
 * 3. Test ALL flows manually: signup, login, verify email, reset password, logout
 * 4. Verify on Chrome: /login renders, /dashboard redirects to /login when unauthenticated
 *
 * DO NOT: create middleware.ts, add client-side profile inserts, remove role tabs
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
// Upstash types only — actual modules are dynamic-imported inside ensureUpstash()
// to keep them out of the middleware's synchronous startup path (P10 budget).
import type { Ratelimit as RatelimitType } from '@upstash/ratelimit';
import type { Redis as RedisType } from '@upstash/redis';
import {
  getUserRoleFromCache,
  findRouteRule,
  destinationForRole,
  type MiddlewareRole,
} from '@/lib/middleware-helpers';
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  generateAnonId,
} from '@/lib/anon-id';
/* ═══════════════════════════════════════════════════════════════
 * PROXY — Security Hardening + Auth Session Refresh
 * Next.js 16 proxy — exported as both proxy (primary) and middleware (compat alias)
 *
 * Defense in depth. Every layer assumes the layer below might be
 * compromised.
 *
 * Layer 0: Subdomain → school config resolution (white-label)
 * Layer 0.5: API Authentication Check
 * Layer 0.6: Protected page route redirects
 * Layer 0.7: School admin portal protection
 * Layer 0.8: Session validation (device limit)
 * Layer 1: Supabase session refresh (keeps auth cookies fresh)
 * Layer 2: Security headers (XSS, clickjacking, MIME sniffing)
 * Layer 2.1: Bot/scanner blocking
 * Layer 2.5: Super admin protection
 * Layer 3: Distributed rate limiting (Upstash Redis, falls back to in-memory)
 * Layer 4: Request validation
 *
 * RLS policies in PostgreSQL remain the true auth boundary.
 * ═══════════════════════════════════════════════════════════════ */

// ── Rate limiting: Distributed (Upstash Redis) with in-memory fallback ──
const RATE_LIMIT_MAX = 200;       // 200 requests per minute per IP (each page load = 5-8 API calls)
const RATE_LIMIT_PARENT_MAX = 20; // 20 parent requests per minute per IP
const RATE_LIMIT_ADMIN_MAX = 60;  // 60 requests per minute for /internal/admin/*

// Distributed rate limiter via Upstash Redis (works across all Vercel instances).
// Modules are lazy-loaded on first use to keep them off the middleware's
// synchronous startup path. Behavior is identical to static init: if env vars
// are missing or construction throws, we fall back to in-memory limiting.
let redisClient: RedisType | null = null;
let redisRateLimiter: RatelimitType | null = null;
let redisParentLimiter: RatelimitType | null = null;
let redisAdminLimiter: RatelimitType | null = null;
let upstashInitPromise: Promise<void> | null = null;
let upstashInitialized = false;

async function ensureUpstash(): Promise<void> {
  if (upstashInitialized) return;
  if (upstashInitPromise) return upstashInitPromise;

  upstashInitPromise = (async () => {
    try {
      if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        const [{ Redis }, { Ratelimit }] = await Promise.all([
          import('@upstash/redis'),
          import('@upstash/ratelimit'),
        ]);
        redisClient = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        redisRateLimiter = new Ratelimit({ redis: redisClient, limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, '1 m'), prefix: 'rl:general' });
        redisParentLimiter = new Ratelimit({ redis: redisClient, limiter: Ratelimit.slidingWindow(RATE_LIMIT_PARENT_MAX, '1 m'), prefix: 'rl:parent' });
        redisAdminLimiter = new Ratelimit({ redis: redisClient, limiter: Ratelimit.slidingWindow(RATE_LIMIT_ADMIN_MAX, '1 m'), prefix: 'rl:admin' });
      }
    } catch {
      // Redis initialization failed (invalid URL, module load, etc.) — fall back to in-memory
      redisClient = null;
      redisRateLimiter = null;
      redisParentLimiter = null;
      redisAdminLimiter = null;
    } finally {
      upstashInitialized = true;
    }
  })();

  return upstashInitPromise;
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
  await ensureUpstash();
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

// ── Session validation cache (5-minute TTL, prevents DB hit on every request) ──
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const _sessionCache = new Map<string, { valid: boolean; checkedAt: number }>();
const SESSION_CACHE_MAX = 5000;

/**
 * Validate a session ID against the user_active_sessions table.
 * Uses a 3-tier cache: in-memory → Redis → Supabase REST API.
 * FAIL-OPEN: returns null (allow through) on any error. Only returns false
 * when the session is confirmed revoked (is_active = false).
 */
async function validateSessionCached(sessionId: string): Promise<boolean | null> {
  // Tier 1: In-memory cache (same Vercel instance)
  const cached = _sessionCache.get(sessionId);
  if (cached && Date.now() - cached.checkedAt < SESSION_CACHE_TTL) {
    return cached.valid;
  }

  await ensureUpstash();

  // Tier 2: Redis cache (shared across Vercel instances)
  if (redisClient) {
    try {
      const redisKey = `sess:valid:${sessionId}`;
      const redisVal = await redisClient.get<string>(redisKey);
      if (redisVal !== null && redisVal !== undefined) {
        const valid = redisVal === '1';
        _sessionCache.set(sessionId, { valid, checkedAt: Date.now() });
        return valid;
      }
    } catch { /* Redis unavailable, fall through to Supabase */ }
  }

  // Tier 3: Supabase REST API (source of truth)
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return null; // Can't validate, allow through

    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_active_sessions?id=eq.${encodeURIComponent(sessionId)}&select=is_active&limit=1`,
      {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );

    if (!res.ok) return null; // DB error, allow through
    const rows = await res.json();

    if (rows.length === 0) {
      // Session ID not found — might be stale cookie, allow through but don't cache
      return null;
    }

    const valid = rows[0].is_active === true;

    // Cache the result in memory
    _sessionCache.set(sessionId, { valid, checkedAt: Date.now() });

    // Evict oldest entries if cache is too large
    if (_sessionCache.size > SESSION_CACHE_MAX) {
      const entries = [..._sessionCache.entries()];
      entries.sort((a, b) => a[1].checkedAt - b[1].checkedAt);
      for (let i = 0; i < entries.length / 2; i++) {
        _sessionCache.delete(entries[i][0]);
      }
    }

    // Also cache in Redis for cross-instance sharing (5 min TTL)
    if (redisClient) {
      try {
        await redisClient.set(`sess:valid:${sessionId}`, valid ? '1' : '0', { ex: 300 });
      } catch { /* Redis unavailable, in-memory cache is sufficient */ }
    }

    return valid;
  } catch {
    return null; // Network error, allow through
  }
}

// ── Subdomain → School resolution (white-label) ──────────────────────
// Schools access Alfanumrik via <slug>.alfanumrik.com. This cache avoids
// a DB query on every request (5-minute TTL, 1-minute negative cache).
const schoolCache = new Map<string, { data: SchoolConfig | null; expires: number }>();

interface SchoolConfig {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  tagline: string | null;
  settings: Record<string, unknown>;
}

function extractSubdomain(host: string): string | null {
  // Strip port (e.g., "dps-noida.localhost:3000" → "dps-noida.localhost")
  const hostWithoutPort = host.split(':')[0];
  const parts = hostWithoutPort.split('.');

  // school-slug.alfanumrik.com (3+ parts, not www)
  if (parts.length >= 3 && parts[0] !== 'www') {
    return parts[0];
  }

  // school-slug.localhost (local dev)
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost' && parts[0] !== 'localhost') {
    return parts[0];
  }

  return null;
}

async function getSchoolBySlug(
  slug: string,
  sbUrl: string,
  sbKey: string
): Promise<SchoolConfig | null> {
  const cached = schoolCache.get(slug);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    // Direct PostgREST query with anon key — lightweight for edge middleware.
    // School branding is non-sensitive public info. If no RLS policy allows
    // anonymous/authenticated SELECT on schools, the query returns empty and
    // we fall through to default Alfanumrik branding.
    const url = `${sbUrl}/rest/v1/schools?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&select=id,name,slug,logo_url,primary_color,secondary_color,tagline,settings&limit=1`;
    const res = await fetch(url, {
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
      },
    });

    if (!res.ok) {
      schoolCache.set(slug, { data: null, expires: Date.now() + 60_000 });
      return null;
    }

    const rows = await res.json();
    const data: SchoolConfig | null = rows?.[0] ?? null;

    const ttl = data ? 5 * 60_000 : 60_000;
    schoolCache.set(slug, { data, expires: Date.now() + ttl });

    evictStaleSchoolCache();
    return data;
  } catch {
    return null;
  }
}

/**
 * Resolve a custom domain (e.g., learn.dps.com) to a school config.
 * Uses the schools.custom_domain column + domain_verified check.
 */
async function getSchoolByCustomDomain(
  domain: string,
  sbUrl: string,
  sbKey: string
): Promise<SchoolConfig | null> {
  const cacheKey = `domain:${domain}`;
  const cached = schoolCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const url = `${sbUrl}/rest/v1/schools?custom_domain=eq.${encodeURIComponent(domain)}&is_active=eq.true&domain_verified=eq.true&select=id,name,slug,logo_url,primary_color,secondary_color,tagline,settings&limit=1`;
    const res = await fetch(url, {
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
      },
    });

    if (!res.ok) {
      schoolCache.set(cacheKey, { data: null, expires: Date.now() + 60_000 });
      return null;
    }

    const rows = await res.json();
    const data: SchoolConfig | null = rows?.[0] ?? null;

    const ttl = data ? 5 * 60_000 : 60_000;
    schoolCache.set(cacheKey, { data, expires: Date.now() + ttl });

    evictStaleSchoolCache();
    return data;
  } catch {
    return null;
  }
}

function evictStaleSchoolCache(): void {
  if (schoolCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of schoolCache.entries()) {
      if (v.expires < now) schoolCache.delete(k);
    }
  }
}

/**
 * Ensure the anonymous-visitor identity cookie (`alf_anon_id`) is present.
 *
 * Reason: src/lib/feature-flags.ts → hashForRollout() needs a stable per-visitor
 * key so that rollout_percentage > 0 deterministically samples anonymous traffic
 * (otherwise the existing fallback treats any rollout > 0 as 100% on for anon
 * visitors, breaking the canary). The cookie cannot be reliably set from a
 * Server Component in Next 16 — only middleware, route handlers, and server
 * actions can mutate cookies on the response. Setting it here in middleware
 * means the FIRST request from a new visitor lands a Set-Cookie header on the
 * response, and every subsequent request carries the same id.
 *
 * Properties (mirrors src/lib/anon-id.ts buildAnonIdCookieAttributes()):
 *   - 365-day Max-Age
 *   - Path=/
 *   - SameSite=Lax (CSRF-safe, allows cross-origin GET navigation)
 *   - Secure in production (HTTPS only)
 *   - httpOnly: false — analytics/clients may read it for downstream attribution.
 *     This is NOT a security identifier; do not use it for auth, RBAC, or PII.
 *
 * Idempotent: if the cookie already exists on the request, no Set-Cookie is
 * emitted.
 */
export function ensureAnonIdCookie(request: NextRequest, response: NextResponse): void {
  const existing = request.cookies.get(ANON_ID_COOKIE)?.value;
  if (existing) return;
  response.cookies.set({
    name: ANON_ID_COOKIE,
    value: generateAnonId(),
    maxAge: ANON_ID_MAX_AGE_SECONDS,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  });
}

/** Known B2C hostnames — no tenant resolution needed */
const B2C_HOSTS = new Set([
  'alfanumrik.com', 'www.alfanumrik.com', 'app.alfanumrik.com',
  'alfanumrik.vercel.app', 'alfanumrik-ten.vercel.app',
]);

function isB2CHost(host: string): boolean {
  const h = host.split(':')[0].toLowerCase();
  if (h === 'localhost' || h.startsWith('localhost')) return true;
  if (h.endsWith('.vercel.app')) return true;
  return B2C_HOSTS.has(h);
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

  // ── Layer 0: Subdomain / Custom Domain → School resolution (white-label) ──
  // Extract subdomain or custom domain early (before auth) so school headers
  // are available to all downstream layers and client-side SchoolContext.
  // B2C domains (alfanumrik.com, www, app, localhost, *.vercel.app) skip this entirely.
  const host = request.headers.get('host') || '';
  const subdomain = extractSubdomain(host);
  let schoolConfig: SchoolConfig | null = null;
  let isExplicitTenantRequest = false; // true when host is a school subdomain or custom domain

  if (!isB2CHost(host)) {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (sbUrl && sbKey) {
      if (subdomain) {
        // Try slug-based resolution (*.alfanumrik.com)
        schoolConfig = await getSchoolBySlug(subdomain, sbUrl, sbKey);
        isExplicitTenantRequest = true;
      } else {
        // Try custom domain resolution (learn.dps.com)
        const normalizedHost = host.split(':')[0].toLowerCase();
        schoolConfig = await getSchoolByCustomDomain(normalizedHost, sbUrl, sbKey);
        isExplicitTenantRequest = true;
      }

      // Add school origin to CORS for this request
      if (schoolConfig) {
        if (subdomain) {
          ALLOWED_ORIGINS.push(`https://${subdomain}.alfanumrik.com`);
          if (process.env.NODE_ENV !== 'production') {
            ALLOWED_ORIGINS.push(`http://${subdomain}.localhost:3000`);
          }
        }
        if (origin && !ALLOWED_ORIGINS.includes(origin)) {
          ALLOWED_ORIGINS.push(origin);
        }
      }
    }

    // If this is an explicit tenant request but no school found → 404
    if (isExplicitTenantRequest && !schoolConfig) {
      return new NextResponse(
        '<html><body style="background:#0f0f0f;color:#e0e0e0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:48px;margin-bottom:16px">🏫</div><h1 style="font-size:20px;margin-bottom:8px">School Not Found</h1><p style="color:#888;font-size:14px">This school is not registered on Alfanumrik.</p><a href="https://alfanumrik.com" style="color:#7C3AED;margin-top:16px;display:inline-block">Go to Alfanumrik →</a></div></body></html>',
        { status: 404, headers: { 'Content-Type': 'text/html' } }
      );
    }
  }

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

  // Track the authenticated user id (if any) and whether auth is degraded.
  // authUserId is consumed by Layer 0.65 (role-based route protection).
  // authDegraded is forwarded as `x-auth-degraded: true` so downstream API
  // handlers know Supabase was unreachable (they must still run their own
  // authorizeRequest() check, but can choose to emit a softer error surface).
  let authUserId: string | null = null;
  let authDegraded = false;

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

    // Refresh the session — this extends the cookie expiry.
    // DEFENSIVE: a Supabase outage here used to crash the middleware,
    // taking down EVERY request (including public pages, health checks,
    // and login). We now swallow errors and continue without a user —
    // API routes will still enforce auth via authorizeRequest(), and
    // unauthenticated page requests still hit the downstream cookie checks.
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        // getUser() returns an error on invalid/expired JWT, network failure,
        // or service outage. AuthSessionMissingError is the normal "no session"
        // case and should NOT be flagged as degraded.
        const errName = (error as { name?: string } | null)?.name ?? '';
        const isNoSession = errName === 'AuthSessionMissingError';
        if (!isNoSession) {
          authDegraded = true;
          // Best-effort structured log. We avoid importing @/lib/logger in the
          // middleware synchronous path (logger pulls in Sentry + redactor =
          // too heavy for middleware bundle). A plain console.warn in the Edge
          // runtime is captured by Vercel logs.
          console.warn(JSON.stringify({
            level: 'warn',
            message: 'middleware_auth_degraded',
            route: path,
            errorName: errName || 'unknown',
            errorMessage: (error as { message?: string } | null)?.message ?? 'unknown',
          }));
        }
      } else {
        authUserId = data?.user?.id ?? null;
      }
    } catch (err) {
      // Network error, Supabase outage, or any other unexpected throw.
      // Fail-open: continue without a user. Downstream auth checks still run.
      authDegraded = true;
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'middleware_auth_crash',
        route: path,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  // Forward degraded-auth signal to downstream handlers (API routes, server
  // components). They can read this from request.headers.get('x-auth-degraded').
  if (authDegraded) {
    response.headers.set('x-auth-degraded', 'true');
  }

  // ── Layer 0.7: Anonymous-visitor identity (alf_anon_id) ──
  // Mint the anon-id cookie on first visit so feature-flag rollout sampling is
  // deterministic for logged-out traffic. Must run AFTER the Supabase block
  // (which can recreate `response` inside setAll) and BEFORE any early-return
  // redirects below so the cookie persists through the first hop.
  // See ensureAnonIdCookie() above for cookie attributes.
  ensureAnonIdCookie(request, response);

  // ── Layer 0.65: Role-based route protection (DISABLED) ──
  //
  // TEMPORARILY DISABLED due to a production auth cookie propagation bug.
  //
  // Root cause: when this layer called `NextResponse.redirect(...)` for a
  // role mismatch, the new response did NOT carry forward the Supabase
  // session cookies set earlier by `supabase.auth.getUser()` during session
  // refresh. Downstream the user's session appeared missing, causing
  // "AuthSessionMissingError" for teacher/parent/admin logins (students
  // routed to /dashboard which has no rule, so they were unaffected).
  //
  // Safe to disable because:
  //   - RLS policies in PostgreSQL remain the true auth boundary
  //   - API routes enforce via authorizeRequest()
  //   - Client-side AuthContext + per-page redirects handle role routing
  //
  // TODO(reintroduce): When re-enabling, clone cookies from the current
  // `response` onto the redirect response before returning. Reference
  // pattern: `const redirect = NextResponse.redirect(...); response.cookies
  // .getAll().forEach(c => redirect.cookies.set(c.name, c.value, c));
  // return redirect;`
  //
  // Keep the helper imports so the follow-up fix is a one-liner.
  void findRouteRule;
  void getUserRoleFromCache;
  void destinationForRole;

  // ── Inject school config headers (after response is created) ──
  // These headers are read by /api/school-config and forwarded to SchoolContext.
  // Also injected into request headers for API routes to consume via tenantFromHeaders().
  if (schoolConfig) {
    response.headers.set('x-school-id', schoolConfig.id);
    response.headers.set('x-school-name', encodeURIComponent(schoolConfig.name));
    response.headers.set('x-school-slug', schoolConfig.slug);
    response.headers.set('x-school-logo', schoolConfig.logo_url || '');
    response.headers.set('x-school-primary-color', schoolConfig.primary_color || '#7C3AED');
    response.headers.set('x-school-secondary-color', schoolConfig.secondary_color || '#F97316');
    response.headers.set('x-school-tagline', encodeURIComponent(schoolConfig.tagline || ''));
  }

  // ── Layer 0.8: Session Validation (device limit enforcement) ──
  // Check if the user's session has been revoked (e.g., exceeded 2-device limit).
  // FAIL-OPEN: only blocks when we KNOW the session is revoked.
  const alfanumrikSid = request.cookies.get('alfanumrik_sid')?.value;
  const hasSessionForValidation = request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name));
  if (alfanumrikSid && hasSessionForValidation) {
    const isValid = await validateSessionCached(alfanumrikSid);
    if (isValid === false) {
      // Session was revoked — force logout
      const logoutUrl = new URL('/login?error=session_revoked', request.url);
      const logoutRes = NextResponse.redirect(logoutUrl);
      // Clear the session cookie
      logoutRes.cookies.delete('alfanumrik_sid');
      // Clear Supabase auth cookies to fully log out
      request.cookies.getAll().forEach(c => {
        if (/^sb-.+-auth-token/.test(c.name)) {
          logoutRes.cookies.delete(c.name);
        }
      });
      return logoutRes;
    }
  }

  // ── Layer 0.9: REMOVED ──
  // Route protection is handled client-side by AuthContext + RLS at DB level.
  // Cookie-based checks here broke signInWithPassword() flow because that method
  // stores tokens in localStorage, not cookies. DO NOT re-add cookie-based
  // route protection without first migrating the browser client to @supabase/ssr.
  //
  // STUDENT_PROTECTED routes (documented here for reference; enforcement is client-side):
  // '/dashboard', '/quiz', '/foxy', '/progress', '/learn',
  // '/profile', '/reports', '/study-plan', '/review', '/scan',
  // '/notifications', '/exams', '/leaderboard', '/hpc', '/simulations',
  // '/stem-centre', '/research', '/billing'

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
      const welcomeRedirect = NextResponse.redirect(new URL('/welcome', request.url));
      // Carry the alf_anon_id cookie forward onto the redirect response so the
      // first-time anon visitor's id lands before the welcome page renders
      // (otherwise the Set-Cookie on `response` is discarded by this early return).
      ensureAnonIdCookie(request, welcomeRedirect);
      return welcomeRedirect;
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
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|robots.txt).*)',
  ],
};

// Alias for backward-compatibility with test imports (import('@/proxy').middleware)
export { proxy as middleware };
