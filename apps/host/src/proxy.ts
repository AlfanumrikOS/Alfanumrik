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
// Upstash types only — actual modules are dynamic-imported inside ensureUpstash()
// to keep them out of the middleware's synchronous startup path (P10 budget).
import type { Ratelimit as RatelimitType } from '@upstash/ratelimit';
import type { Redis as RedisType } from '@upstash/redis';
import {
  getUserRoleFromCache,
  findRouteRule,
  destinationForRole,
  ROLE_UNKNOWN,
  type ResolvedMiddlewareRole,
} from '@alfanumrik/lib/middleware-helpers';
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  generateAnonId,
} from '@alfanumrik/lib/anon-id';
import { secureEqual } from '@alfanumrik/lib/secure-compare';
/* ═══════════════════════════════════════════════════════════════
 * PROXY — Security Hardening + Auth Session Refresh
 * Next.js 16 proxy — export only the canonical proxy function.
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
//
// Limits are per-IP. India runs on CGNAT — Jio/Airtel/VI carriers may bucket
// hundreds of subscribers behind a single egress IP — so the general bucket
// has to absorb realistic peak load from many users at once. A normal student
// dashboard mount fires ~10 same-origin API calls (rhythm, dive, synthesis,
// preferences, subjects, feature-flags x N, tenant config, school config,
// auth/session, plus the page nav itself + any _next/data hops between
// /welcome → /login → /dashboard → /foxy). 200 req/min was empirically too
// tight under CGNAT and produced the "JSON viewer instead of page" symptom
// reported by the CEO 2026-05-20 — see rateLimitResponse() below for the
// underlying browser behavior. The new ceiling gives ~30 concurrent users per
// IP for a 60s window. The parent/admin buckets stay tight (auth surface).
const RATE_LIMIT_MAX = 600;       // 600 requests per minute per IP (~30 concurrent users behind CGNAT)
const RATE_LIMIT_PARENT_MAX = 20; // 20 parent requests per minute per IP
const RATE_LIMIT_ADMIN_MAX = 60;  // 60 requests per minute for /internal/admin/*

/**
 * Build the rate-limit response. CRITICAL: returns HTML when the requester is
 * a browser doing a page navigation (Accept: text/html), JSON when it's an
 * XHR / fetch / API client.
 *
 * Why this matters (CEO bug report 2026-05-20):
 *   Browsers asked for an HTML page (e.g., visiting /welcome or /login).
 *   When this layer returned `{"error":"Rate limit exceeded..."}` with
 *   `Content-Type: application/json`, Chromium/Firefox interpret the body as
 *   a JSON document and render the native pretty-printer viewer with the
 *   "Pretty-print" checkbox — exactly what the user screenshotted. There is
 *   no app shell visible, no way to retry except hard refresh, and the user
 *   reasonably assumes the entire site is broken.
 *
 * The HTML body is intentionally inlined (no asset hops) so the rate-limited
 * response doesn't trigger MORE rate-limited sub-requests for CSS or fonts.
 * It is bilingual (Hindi + English) and styled to match the editorial
 * landing palette so it visually belongs to the product even on first
 * impression. Includes meta-refresh to auto-recover after the retry window.
 */
function rateLimitResponse(request: NextRequest, retryAfterSeconds = 60): NextResponse {
  const accept = request.headers.get('accept') || '';
  const wantsHtml =
    accept.includes('text/html') ||
    accept.includes('application/xhtml') ||
    // No Accept header at all → browser navigation in older clients; HTML is
    // the safer surface than raw JSON. fetch() always sends */* by default
    // PLUS x-requested-with or sec-fetch-mode=cors, but mid-2026 browsers
    // still vary, so we only treat the empty-Accept case as HTML if there's
    // no API signal.
    (!accept && request.headers.get('sec-fetch-mode') !== 'cors' &&
      !request.headers.get('x-requested-with'));

  if (!wantsHtml) {
    return new NextResponse(
      JSON.stringify({ error: 'Rate limit exceeded. Please slow down.', retryAfter: retryAfterSeconds }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
        },
      }
    );
  }

  // HTML response — inline, no asset hops. Bilingual. Editorial palette
  // (#FBF8F4 cream, #E8581C orange, #1F1F1F ink) so the page visually
  // belongs to Alfanumrik even on first impression. Meta-refresh after the
  // retry window so users don't have to hit reload.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="refresh" content="${retryAfterSeconds};url=${request.nextUrl.pathname}" />
<title>Just a moment · Alfanumrik</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #FBF8F4;
    color: #1F1F1F;
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    line-height: 1.5;
  }
  .card {
    max-width: 480px;
    width: 100%;
    background: #FFFFFF;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 24px;
    padding: 40px 32px;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0,0,0,0.04);
  }
  .glyph { font-size: 48px; margin-bottom: 16px; line-height: 1; }
  h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 8px;
    color: #1F1F1F;
  }
  p { color: #4A4A4A; font-size: 15px; margin: 0 0 8px; }
  p.hi { color: #6B6B6B; font-size: 14px; }
  .retry {
    display: inline-block;
    margin-top: 20px;
    padding: 12px 24px;
    background: #E8581C;
    color: #FFFFFF;
    text-decoration: none;
    font-weight: 600;
    border-radius: 999px;
    font-size: 14px;
    transition: transform 0.15s ease;
  }
  .retry:hover { transform: translateY(-1px); }
  .fine { color: #8A8A8A; font-size: 12px; margin-top: 16px; }
</style>
</head>
<body>
<main class="card" role="alert" aria-live="polite">
  <div class="glyph" aria-hidden="true">🦊</div>
  <h1>Just a moment</h1>
  <p>Too many requests at once — we'll be ready again in a minute.</p>
  <p class="hi" lang="hi">एक पल — हम एक मिनट में फिर तैयार हैं।</p>
  <a class="retry" href="${request.nextUrl.pathname}">Try again</a>
  <p class="fine">This page will refresh automatically.</p>
</main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 429,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': String(retryAfterSeconds),
      'Cache-Control': 'no-store',
    },
  });
}

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
  if (h.endsWith('.cloudfront.net')) return true;       // AWS CloudFront pseudolinks
  if (h.endsWith('.elb.amazonaws.com')) return true;   // AWS ALB — origin Host header when CloudFront strips viewer Host
  if (h.endsWith('.amazonaws.com')) return true;        // Any other AWS-internal hostname (ECS, etc.)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true; // Raw IP — ALB health checks use private task IP as Host
  // Also trust whatever SITE_URL is configured to (works in Node.js / standalone mode)
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) {
    try {
      const siteHost = new URL(siteUrl).hostname.toLowerCase();
      if (siteHost && h === siteHost) return true;
    } catch { /* ignore invalid SITE_URL */ }
  }
  return B2C_HOSTS.has(h);
}

function inferApiClient(request: NextRequest): string {
  const explicit = request.headers.get('x-client-platform')?.trim().toLowerCase();
  if (explicit) return explicit.slice(0, 40);

  const userAgent = request.headers.get('user-agent')?.toLowerCase() ?? '';
  if (userAgent.includes('android')) return 'android';
  if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ios')) return 'ios';
  if (userAgent.includes('mobile')) return 'mobile';
  return 'web';
}

function rpcFromPath(pathname: string): string | null {
  const prefix = '/rest/v1/rpc/';
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).split('/')[0] || null;
}

async function recordApiRequestLog(request: NextRequest, requestId: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  try {
    const pathname = request.nextUrl.pathname;
    const userAgent = request.headers.get('user-agent') ?? null;
    await fetch(`${supabaseUrl}/rest/v1/api_request_logs`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        path: pathname,
        rpc: rpcFromPath(pathname),
        client: inferApiClient(request),
        method: request.method,
        request_id: requestId,
        user_agent: userAgent ? userAgent.slice(0, 256) : null,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'production',
      }),
    });
  } catch {
    // Best-effort telemetry; never risk auth, routing, or API latency on it.
  }
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const pathname = path; // alias for clarity in API checks

  // The code-backed dev/preview surfaces (V3 review, the UI kitchen-sink, and
  // the cosmic design gallery) must be absent at the HTTP boundary in
  // production. A page-level notFound() can be streamed after a 200 shell in
  // modern Next.js, so enforce a real 404 before rendering as defense in depth.
  // Access is preserved in dev/preview (NODE_ENV !== 'production' and
  // VERCEL_ENV of 'development'/'preview').
  if (
    (process.env.NODE_ENV === 'production' ||
      process.env.VERCEL_ENV === 'production') &&
    (pathname === '/dev/ui' ||
      pathname.startsWith('/dev/ui/') ||
      pathname === '/dev/cosmic-preview' ||
      pathname.startsWith('/dev/cosmic-preview/'))
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // ── /guardian/* → /parent/* permanent redirect ──────────────────────
  // The codebase standardised on `/parent` as the guardian portal route
  // prefix; `/guardian` was a documented alias that never had its own
  // pages and would 404. Status 308 preserves the request method so any
  // POST/PUT issued against `/guardian/*` (e.g. from old emails or
  // Razorpay return URLs) replays cleanly against the canonical path.
  // (Phase 2-A hardening — closes Frontend audit H9.)
  if (pathname === '/guardian' || pathname.startsWith('/guardian/')) {
    const target = pathname === '/guardian'
      ? '/parent'
      : '/parent' + pathname.slice('/guardian'.length);
    const redirectUrl = new URL(target + request.nextUrl.search, request.url);
    return NextResponse.redirect(redirectUrl, { status: 308 });
  }

  // ── /school → /school-admin permanent redirect ──────────────────────
  // Common typo / short URL: users type /school when the portal is at
  // /school-admin. 308 preserves the request method so any POST/PUT
  // (e.g. from old bookmarks or forwarded links) replays cleanly.
  if (pathname === '/school' || pathname.startsWith('/school/')) {
    const target = pathname === '/school'
      ? '/school-admin'
      : '/school-admin' + pathname.slice('/school'.length);
    const redirectUrl = new URL(target + request.nextUrl.search, request.url);
    return NextResponse.redirect(redirectUrl, { status: 308 });
  }

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

  // ── Build forwarded request headers (includes tenant x-school-* if resolved) ──
  // CRITICAL: /api/school-config, /api/tenant/config, /api/school-config/manifest,
  // and lib/tenant.ts → tenantFromHeaders() all read x-school-* off the INCOMING
  // request headers (request.headers.get('x-school-id')). Headers set on the
  // response are invisible to them — the response is what we send back, not what
  // downstream handlers see. We must pass these into NextResponse.next() via
  // `{ request: { headers: requestHeaders } }`, which is the Next.js canonical
  // pattern for forwarding modified request headers to API routes and Server
  // Components in the same request lifecycle.
  //
  // Without this, SchoolContext.tsx fetches /api/school-config, the API route
  // sees no x-school-id, and the client renders default Alfanumrik branding even
  // though tenant lookup (above) succeeded. This defeats the entire white-label
  // substrate.
  const requestHeaders = new Headers(request.headers);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  requestHeaders.set('x-request-id', requestId);
  if (schoolConfig) {
    requestHeaders.set('x-school-id', schoolConfig.id);
    requestHeaders.set('x-school-name', encodeURIComponent(schoolConfig.name));
    requestHeaders.set('x-school-slug', schoolConfig.slug);
    requestHeaders.set('x-school-logo', schoolConfig.logo_url || '');
    requestHeaders.set('x-school-primary-color', schoolConfig.primary_color || '#7C3AED');
    requestHeaders.set('x-school-secondary-color', schoolConfig.secondary_color || '#E8581C');
    requestHeaders.set('x-school-tagline', encodeURIComponent(schoolConfig.tagline || ''));
  }

  if (pathname === '/manifest.json') {
    const rewriteUrl = new URL('/api/school-config/manifest', request.url);
    const rewriteRes = NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
    return addSecurityHeaders(rewriteRes, request, requestId);
  }

  // ── Layer 0: Supabase session refresh ──
  // This keeps the auth cookie fresh on every request.
  // Required for the PKCE email flow (signup confirm, password reset).
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Track the authenticated user id (if any) and whether auth is degraded.
  // authUserId is consumed by Layer 0.65 (role-based route protection).
  // authDegraded is forwarded as `x-auth-degraded: true` so downstream API
  // handlers know Supabase was unreachable (they must still run their own
  // authorizeRequest() check, but can choose to emit a softer error surface).
  let authUserId: string | null = null;
  let authDegraded = false;

  const hasSupabaseAuthCookie = request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name));

  if (supabaseUrl && supabaseKey && hasSupabaseAuthCookie) {
    const { createServerClient } = await import('@supabase/ssr');
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // Preserve the augmented requestHeaders (with tenant context) when
          // Supabase rewrites cookies during session refresh — otherwise the
          // recreated NextResponse drops our x-school-* headers.
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => {
            const safeOptions: any = { ...options };
            if (typeof safeOptions.sameSite === 'string' && safeOptions.sameSite.toLowerCase() === 'none') {
              safeOptions.sameSite = 'lax';
            }
            response.cookies.set(name, value, safeOptions);
          });
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
          // Best-effort structured log. We avoid importing @alfanumrik/lib/logger in the
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

  // ── Layer 0.65: Role-based route protection ──
  //
  // Prevents URL-level cross-portal navigation: a student who clicks/types
  // /teacher/* must not land on a teacher-only page even if the data is
  // RLS-protected (the broken UI is a poor UX). RLS at the DB layer remains
  // the true authorization boundary; this layer is defense-in-depth and a UX
  // affordance, not a security primitive.
  //
  // History (audit F26): this layer was previously disabled due to a cookie
  // propagation bug — when `NextResponse.redirect(...)` was returned, the
  // Supabase session cookies set earlier by `supabase.auth.getUser()` during
  // session refresh were NOT carried forward, causing "AuthSessionMissingError"
  // for teacher/parent/admin logins on the next request. Fix: clone cookies
  // from the current `response` onto the redirect response before returning.
  //
  // Safety properties:
  //   - Reads role via `getUserRoleFromCache` — Redis + in-memory cache, no
  //     DB roundtrip on the hot path (60s TTL with write-through).
  //   - FAIL-OPEN: any failure (cache miss returns null, auth degraded,
  //     Supabase down) → allow the request through. Downstream RLS, API
  //     `authorizeRequest()`, and client-side redirects still enforce.
  //   - Skipped entirely when `ENABLE_LAYER_065` is not "true". Defaults
  //     to disabled outside production so tests/local dev are unaffected.
  //   - Logs a structured breadcrumb on every blocked navigation (visible
  //     in Vercel logs / Sentry log integrations) so we can observe whether
  //     this layer ever fires unexpectedly in prod.
  //
  // The structured logger is intentionally NOT imported here (logger pulls
  // in Sentry + redactor; too heavy for the middleware bundle per P10).
  // We use `console.warn(JSON.stringify(...))` which is the same pattern
  // used by the auth-degraded log a few lines above.
  const layer065Enabled = (() => {
    const flag = process.env.ENABLE_LAYER_065;
    if (typeof flag === 'string' && flag.length > 0) {
      return flag === 'true' || flag === '1';
    }
    // Default: ON in production, OFF in dev/test/preview to avoid affecting
    // local Playwright runs and unit tests that don't seed roles.
    return process.env.NODE_ENV === 'production';
  })();

  if (layer065Enabled && authUserId && !authDegraded) {
    const rule = findRouteRule(path);
    if (rule) {
      const role: ResolvedMiddlewareRole | null = await getUserRoleFromCache(authUserId);
      // role === null → deterministic misconfig (env vars missing) → fail open.
      // role === ROLE_UNKNOWN → a role probe/RPC failed TRANSIENTLY → fail
      //   open (pass through, no redirect) and never cached, so the next
      //   request re-resolves. 2026-07-20 super-admin route-gating RCA: for
      //   /super-admin (and /api/super-admin, which never matches a rule
      //   here) passing through on 'unknown' is SAFE because every
      //   /api/super-admin route is authorizeAdmin()-gated server-side and
      //   the /super-admin pages render nothing without that API data — the
      //   redirect here is UX defense-in-depth, not the security boundary.
      //   The same fail-open discipline applies to all other route families
      //   (identical to the pre-RCA behavior on lookup failure, which
      //   returned null); RLS + authorizeRequest() remain the real gates.
      // role === 'none' → authenticated but not yet onboarded → /onboarding.
      // role in rule.allowed → allow.
      // role NOT in rule.allowed → redirect to that role's home portal.
      if (role === ROLE_UNKNOWN) {
        // Observability: sampled breadcrumb so we can see how often role
        // resolution is inconclusive in prod (PII-free — path only).
        if (Math.random() < 0.05) {
          console.warn(JSON.stringify({
            level: 'warn',
            message: 'layer_0_65_role_unknown_pass_through',
            from: path,
            rulePrefix: rule.prefix,
          }));
        }
      } else if (role !== null) {
        let redirectTo: string | null = null;
        if (role === 'none') {
          redirectTo = '/onboarding';
        } else if (!rule.allowed.includes(role)) {
          const dest = destinationForRole(role);
          // Loop safety: if destinationForRole returns a path inside this
          // very rule (would re-trigger the same redirect), fall back to
          // /dashboard which has no rule.
          redirectTo = (path === dest || path.startsWith(dest + '/'))
            ? '/dashboard'
            : dest;
        }

        if (redirectTo) {
          const url = new URL(redirectTo, request.url);
          const redirect = NextResponse.redirect(url);

          // CRITICAL — preserve cookies set earlier by supabase.auth.getUser()
          // during session refresh. Without this, the new response loses the
          // Supabase session cookies and the user appears logged out on the
          // next request. This is the bug F26 was tracking.
          response.cookies.getAll().forEach((c) => {
            const sameSiteSafe = typeof c.sameSite === 'string' && c.sameSite.toLowerCase() === 'none' ? 'lax' : c.sameSite;
            redirect.cookies.set({
              name: c.name,
              value: c.value,
              path: c.path,
              domain: c.domain,
              maxAge: c.maxAge,
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: sameSiteSafe,
            });
          });

          // Forward degraded-auth signal too (it was already 'false' here, but
          // be defensive in case another layer added the header).
          const degradedHeader = response.headers.get('x-auth-degraded');
          if (degradedHeader) {
            redirect.headers.set('x-auth-degraded', degradedHeader);
          }

          // Observability: structured log (one line per block). Useful both
          // for spotting misconfigured rules and for confirming the layer is
          // actually active in production. PII-free — only role + path.
          console.warn(JSON.stringify({
            level: 'warn',
            message: 'layer_0_65_role_block',
            from: path,
            to: redirectTo,
            role,
            rulePrefix: rule.prefix,
          }));

          return redirect;
        }
      }
    }
  } else if (!layer065Enabled) {
    // Detect when the layer is disabled in production — this should be
    // surfaced by observability so we can confirm the rollout flag is set.
    // Sampled (1% of requests) to avoid log spam.
    if (process.env.NODE_ENV === 'production' && Math.random() < 0.01) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'layer_0_65_disabled',
        reason: 'ENABLE_LAYER_065 not set to true in production',
        route: path,
      }));
    }
  }

  // ── Mirror school config headers onto the RESPONSE (debug surface only) ──
  // The load-bearing copy is on the FORWARDED REQUEST headers (built above and
  // passed via `NextResponse.next({ request: { headers: requestHeaders } })`)
  // — that's what /api/school-config, /api/tenant/config, manifest, and
  // tenantFromHeaders() actually read. The response-header mirror here is kept
  // purely so the browser DevTools Network panel reveals which tenant was
  // resolved for a given request — useful when triaging "wrong school renders"
  // reports. Nothing in the codebase reads x-school-* off response.headers.
  if (schoolConfig) {
    response.headers.set('x-school-id', schoolConfig.id);
    response.headers.set('x-school-name', encodeURIComponent(schoolConfig.name));
    response.headers.set('x-school-slug', schoolConfig.slug);
    response.headers.set('x-school-logo', schoolConfig.logo_url || '');
    response.headers.set('x-school-primary-color', schoolConfig.primary_color || '#7C3AED');
    response.headers.set('x-school-secondary-color', schoolConfig.secondary_color || '#E8581C');
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
    // Constant-time compares for shared-secret checks — naive `===` short-
    // circuits at the first differing byte and leaks the secret through
    // response timing. The session cookie token is also a derived secret
    // (sha256 prefix) so it gets the same treatment.
    const cookieValid = !!(sessionCookie && expectedCookieToken && secureEqual(sessionCookie, expectedCookieToken));

    const headerValid = !!(headerSecret && secretKey && secureEqual(headerSecret, secretKey));
    const queryValid  = !!(querySecret  && secretKey && secureEqual(querySecret,  secretKey));

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
      // Structured log — admin bucket exhaustion is rare and worth observing.
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'rate_limit_exceeded',
        bucket: 'admin',
        path,
        ip: adminIp,
      }));
      return rateLimitResponse(request);
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
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'rate_limit_exceeded',
        bucket: 'parent',
        path,
        ip,
      }));
      const res = rateLimitResponse(request);
      res.headers.set('X-RateLimit-Remaining', '0');
      return res;
    }

    response.headers.set('X-RateLimit-Remaining', String(remaining));
    return addSecurityHeaders(response, request, requestId);
  }

  // Exempt health endpoint from rate limiting (used by uptime monitors)
  if (pathname === '/api/v1/health') {
    return addSecurityHeaders(response, request, requestId);
  }

  // Exempt provider webhook receivers from the general rate limiter.
  //
  // Why: Razorpay (and any payment provider) delivers webhooks from a small
  // pool of static egress IPs that are shared across many merchants. Even
  // moderate per-customer activity against the same Razorpay account can
  // exceed the 200 req/min general bucket on a single IP. When that happens
  // we return HTTP 429 — which Razorpay treats as a TERMINAL failure (it
  // retries 5xx but NOT 4xx), so the webhook is silently dropped and the
  // student stays on a stale plan despite a captured payment. Observed
  // 2026-05-09 (hridaankaushik307@gmail.com): verify 401'd, the webhook
  // would have been the safety net but never landed. payment_webhook_events
  // table has been empty since it was created on 2026-04-25.
  //
  // Security: this does NOT remove auth on the webhook. The route handler
  // verifies the Razorpay HMAC signature on every request before any DB
  // write (see src/app/api/payments/webhook/route.ts and
  // src/lib/payment-verification.ts). A flood of bogus requests is rejected
  // with 400 by the signature check; a flood with valid signatures implies
  // the webhook secret has leaked, which is a much larger incident.
  //
  // Scope: only /api/payments/webhook. Cron endpoints (/api/cron/*) keep
  // the limit because they're called by Vercel's cron with CRON_SECRET and
  // never need to be open to external IPs.
  if (pathname === '/api/payments/webhook') {
    return addSecurityHeaders(response, request, requestId);
  }

  // Synthetic host-monitor probes (Edge Function `synthetic-host-monitor`)
  // GET /api/school-config across every school host in a 5-minute burst from
  // a small set of Supabase egress IPs — which exhausted the general bucket
  // and made the monitor record 100% http_4xx (verified 2026-07-13, first
  // ticks after the 17-day outage fix). Exempt ONLY that exact probe shape:
  // GET + /api/school-config + the monitor's UA prefix. school-config is a
  // public, read-only, unauthenticated config read (no user data, no writes),
  // so a spoofed-UA bypass gains an attacker nothing beyond that public
  // endpoint; every other path/method keeps full rate limiting.
  const isSyntheticMonitorProbe =
    request.method === 'GET' &&
    pathname === '/api/school-config' &&
    (request.headers.get('user-agent') ?? '').startsWith('Alfanumrik-Synthetic-Monitor/');
  if (isSyntheticMonitorProbe) {
    return addSecurityHeaders(response, request, requestId);
  }

  // General rate limit for all routes
  const { allowed, remaining: generalRemaining } = await checkRateLimit(`general:${ip}`, RATE_LIMIT_MAX, 'general');
  if (!allowed) {
    // Structured log — the CEO-reported "JSON viewer at /welcome" symptom
    // (2026-05-20) was a general-bucket exhaustion under CGNAT. Logging the
    // path + the Accept signature lets us distinguish "browser nav landed
    // on the rate limit" (returns HTML now) from "real API flood" in
    // production logs without exposing PII.
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'rate_limit_exceeded',
      bucket: 'general',
      path,
      ip,
      accept: request.headers.get('accept')?.slice(0, 64) ?? null,
    }));
    return rateLimitResponse(request);
  }

  // Add rate limit + security headers for API routes
  if (pathname.startsWith('/api/v1/') || pathname.startsWith('/api/')) {
    response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
    response.headers.set('X-RateLimit-Remaining', String(generalRemaining));
    void recordApiRequestLog(request, requestId);

    // Prevent CDN/browser from caching API responses (personalized data)
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');

    // Add CORS headers for API routes (origin-checked, not wildcard)
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-request-id');
    response.headers.set('Vary', 'Origin');
  }

  return addSecurityHeaders(response, request, requestId);
}

function addSecurityHeaders(
  response: NextResponse,
  request: NextRequest,
  requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
): NextResponse {
  // ── Layer 1: Security Headers ──

  // Request ID for incident tracing; preserve caller-supplied IDs so host
  // routes, Edge Functions, logs, and the browser-visible response agree.
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
    '/((?!_next/static|_next/image|favicon.ico|sw.js|icons|robots.txt).*)',
  ],
};
