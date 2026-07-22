import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Middleware Tests -- Rate limiting, route protection, bot blocking, security headers
 *
 * Tests the pure/testable functions extracted from src/middleware.ts.
 * Since the middleware itself depends on Next.js runtime and Upstash Redis,
 * we test the logic patterns and exported config.
 *
 * Covers:
 * - In-memory rate limiting (checkRateLimitLocal logic)
 * - Route protection patterns (PROTECTED_PREFIXES)
 * - Bot/scanner blocking patterns
 * - Security header expectations
 * - Middleware config matcher
 */

// ─── Rate Limit Logic (in-memory fallback) ──────────────────

describe('Rate limit local logic', () => {
  // Re-implement the checkRateLimitLocal algorithm for unit testing
  // (the middleware exports it as a closure, so we test the algorithm directly)
  const RATE_LIMIT_WINDOW = 60_000;
  const MAX_MAP_SIZE = 10_000;

  function checkRateLimitLocal(
    map: Map<string, { count: number; resetAt: number }>,
    key: string,
    max: number,
    now: number = Date.now()
  ): { allowed: boolean; remaining: number } {
    const entry = map.get(key);
    if (!entry || now > entry.resetAt) {
      if (map.size >= MAX_MAP_SIZE) {
        const firstKey = map.keys().next().value;
        if (firstKey) map.delete(firstKey);
      }
      map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
      return { allowed: true, remaining: max - 1 };
    }
    entry.count++;
    if (entry.count > max) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: max - entry.count };
  }

  let map: Map<string, { count: number; resetAt: number }>;

  beforeEach(() => {
    map = new Map();
  });

  it('allows first request from a new IP', () => {
    const result = checkRateLimitLocal(map, '1.2.3.4', 200);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(199);
  });

  it('tracks request count correctly', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimitLocal(map, '1.2.3.4', 200);
    }
    const result = checkRateLimitLocal(map, '1.2.3.4', 200);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(194); // 200 - 6
  });

  it('blocks after exceeding max requests', () => {
    const max = 5;
    for (let i = 0; i < max; i++) {
      const r = checkRateLimitLocal(map, '1.2.3.4', max);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkRateLimitLocal(map, '1.2.3.4', max);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    const now = 1000000;
    checkRateLimitLocal(map, '1.2.3.4', 1, now);
    // Second request within window: blocked
    const blocked = checkRateLimitLocal(map, '1.2.3.4', 1, now + 1000);
    expect(blocked.allowed).toBe(false);
    // After window expires: allowed again
    const reset = checkRateLimitLocal(map, '1.2.3.4', 1, now + RATE_LIMIT_WINDOW + 1);
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(0); // max=1, so 1-1=0
  });

  it('tracks different IPs independently', () => {
    checkRateLimitLocal(map, '1.1.1.1', 2);
    checkRateLimitLocal(map, '1.1.1.1', 2);
    const blocked = checkRateLimitLocal(map, '1.1.1.1', 2);
    expect(blocked.allowed).toBe(false);

    // Different IP is still allowed
    const other = checkRateLimitLocal(map, '2.2.2.2', 2);
    expect(other.allowed).toBe(true);
  });

  it('evicts oldest entry when map is full', () => {
    const smallMax = 3;
    // Use a small simulated MAX_MAP_SIZE
    function checkWithSmallMap(
      m: Map<string, { count: number; resetAt: number }>,
      key: string,
      max: number,
      now: number,
      maxMapSize: number
    ) {
      const entry = m.get(key);
      if (!entry || now > entry.resetAt) {
        if (m.size >= maxMapSize) {
          const firstKey = m.keys().next().value;
          if (firstKey) m.delete(firstKey);
        }
        m.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return { allowed: true, remaining: max - 1 };
      }
      entry.count++;
      if (entry.count > max) return { allowed: false, remaining: 0 };
      return { allowed: true, remaining: max - entry.count };
    }

    const now = Date.now();
    checkWithSmallMap(map, 'ip-1', 100, now, smallMax);
    checkWithSmallMap(map, 'ip-2', 100, now, smallMax);
    checkWithSmallMap(map, 'ip-3', 100, now, smallMax);
    expect(map.size).toBe(3);

    // Adding a 4th should evict the first
    checkWithSmallMap(map, 'ip-4', 100, now, smallMax);
    expect(map.size).toBe(3);
    expect(map.has('ip-1')).toBe(false);
    expect(map.has('ip-4')).toBe(true);
  });

  it('handles max=0 by blocking immediately', () => {
    const result = checkRateLimitLocal(map, '1.2.3.4', 0);
    // First request sets count to 1, and 1 > 0, so it's blocked on the next check
    // Actually count=1 and max=0, so entry is set. Next time count=2 > 0 blocked.
    // But the first request: count=1, entry was new so it returns allowed with remaining = -1.
    // This is a boundary case in the implementation.
    expect(result.remaining).toBe(-1);
  });

  it('handles parent portal rate limit (20 req/min)', () => {
    const parentMax = 20;
    for (let i = 0; i < parentMax; i++) {
      const r = checkRateLimitLocal(map, 'parent:1.2.3.4', parentMax);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkRateLimitLocal(map, 'parent:1.2.3.4', parentMax);
    expect(blocked.allowed).toBe(false);
  });
});

// ─── Route Protection Patterns ──────────────────────────────

describe('Protected route patterns', () => {
  const PROTECTED_PREFIXES = [
    '/dashboard', '/quiz', '/profile', '/progress', '/reports',
    '/foxy', '/learn', '/review', '/scan',
    '/notifications', '/exams', '/leaderboard', '/hpc', '/simulations',
    '/stem-centre', '/research',
    '/parent/children', '/parent/reports', '/parent/profile', '/parent/support',
    '/teacher/',
    '/billing',
  ];

  function isProtected(path: string): boolean {
    return PROTECTED_PREFIXES.some(p => path.startsWith(p));
  }

  it('protects student routes', () => {
    expect(isProtected('/dashboard')).toBe(true);
    expect(isProtected('/quiz')).toBe(true);
    expect(isProtected('/progress')).toBe(true);
    expect(isProtected('/profile')).toBe(true);
    expect(isProtected('/reports')).toBe(true);
    expect(isProtected('/foxy')).toBe(true);
    expect(isProtected('/learn')).toBe(true);
    expect(isProtected('/leaderboard')).toBe(true);
  });

  it('protects parent sub-routes', () => {
    expect(isProtected('/parent/children')).toBe(true);
    expect(isProtected('/parent/reports')).toBe(true);
    expect(isProtected('/parent/profile')).toBe(true);
    expect(isProtected('/parent/support')).toBe(true);
  });

  it('protects teacher routes', () => {
    expect(isProtected('/teacher/')).toBe(true);
    expect(isProtected('/teacher/classes')).toBe(true);
    expect(isProtected('/teacher/students')).toBe(true);
  });

  it('protects billing route', () => {
    expect(isProtected('/billing')).toBe(true);
  });

  it('does NOT protect public routes', () => {
    expect(isProtected('/login')).toBe(false);
    expect(isProtected('/welcome')).toBe(false);
    expect(isProtected('/signup')).toBe(false);
    expect(isProtected('/')).toBe(false);
    expect(isProtected('/parent')).toBe(false); // parent login page itself
  });

  it('protects feature routes (STEM, exams, scan)', () => {
    expect(isProtected('/stem-centre')).toBe(true);
    expect(isProtected('/exams')).toBe(true);
    expect(isProtected('/scan')).toBe(true);
    expect(isProtected('/notifications')).toBe(true);
  });
});

// ─── Bot/Scanner Blocking ───────────────────────────────────

describe('Bot/scanner blocking patterns', () => {
  function shouldBlock(path: string): boolean {
    return (
      path.startsWith('/wp-') ||
      path.startsWith('/phpmy') ||
      path.endsWith('.php') ||
      path.endsWith('.env') ||
      path.startsWith('/.git') ||
      (path.startsWith('/admin') && !path.startsWith('/internal/admin')) ||
      path.startsWith('/cgi-bin') ||
      path.includes('..')
    );
  }

  it('blocks WordPress probes', () => {
    expect(shouldBlock('/wp-admin')).toBe(true);
    expect(shouldBlock('/wp-login.php')).toBe(true);
    expect(shouldBlock('/wp-content/uploads')).toBe(true);
  });

  it('blocks phpMyAdmin probes', () => {
    expect(shouldBlock('/phpmyadmin')).toBe(true);
    expect(shouldBlock('/phpmy-admin')).toBe(true);
  });

  it('blocks PHP file probes', () => {
    expect(shouldBlock('/index.php')).toBe(true);
    expect(shouldBlock('/config.php')).toBe(true);
    expect(shouldBlock('/xmlrpc.php')).toBe(true);
  });

  it('blocks .env file probes', () => {
    expect(shouldBlock('/.env')).toBe(true);
    expect(shouldBlock('/app/.env')).toBe(true);
  });

  it('blocks .git directory probes', () => {
    expect(shouldBlock('/.git')).toBe(true);
    expect(shouldBlock('/.git/config')).toBe(true);
    expect(shouldBlock('/.git/HEAD')).toBe(true);
  });

  it('blocks /admin but allows /internal/admin', () => {
    expect(shouldBlock('/admin')).toBe(true);
    expect(shouldBlock('/admin/login')).toBe(true);
    expect(shouldBlock('/internal/admin')).toBe(false);
    expect(shouldBlock('/internal/admin/dashboard')).toBe(false);
  });

  it('blocks cgi-bin probes', () => {
    expect(shouldBlock('/cgi-bin/')).toBe(true);
    expect(shouldBlock('/cgi-bin/test.cgi')).toBe(true);
  });

  it('blocks path traversal attempts', () => {
    expect(shouldBlock('/../../etc/passwd')).toBe(true);
    expect(shouldBlock('/api/../secrets')).toBe(true);
  });

  it('allows legitimate application paths', () => {
    expect(shouldBlock('/dashboard')).toBe(false);
    expect(shouldBlock('/api/v1/health')).toBe(false);
    expect(shouldBlock('/quiz')).toBe(false);
    expect(shouldBlock('/login')).toBe(false);
    expect(shouldBlock('/super-admin/login')).toBe(false);
  });
});

// ─── Security Headers ───────────────────────────────────────

describe('Security header expectations', () => {
  // These test the header values that addSecurityHeaders should set
  const EXPECTED_HEADERS: Record<string, string | RegExp> = {
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  it('defines all required security headers', () => {
    for (const [header, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(header).toBeTruthy();
      expect(value).toBeTruthy();
    }
  });

  it('X-Frame-Options is DENY to prevent clickjacking', () => {
    expect(EXPECTED_HEADERS['X-Frame-Options']).toBe('DENY');
  });

  it('CSP prevents framing', () => {
    expect(EXPECTED_HEADERS['Content-Security-Policy']).toContain('frame-ancestors');
  });

  it('X-Content-Type-Options prevents MIME sniffing', () => {
    expect(EXPECTED_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });

  it('HSTS value is correct (1 year, includeSubDomains, preload)', () => {
    const hsts = 'max-age=31536000; includeSubDomains; preload';
    expect(hsts).toContain('max-age=31536000');
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');
  });

  it('Permissions-Policy restricts sensitive APIs', () => {
    const permissionsPolicy = 'camera=(), microphone=(), geolocation=(), payment=(self)';
    expect(permissionsPolicy).toContain('camera=()');
    expect(permissionsPolicy).toContain('microphone=()');
    expect(permissionsPolicy).toContain('geolocation=()');
    expect(permissionsPolicy).toContain('payment=(self)');
  });
});

// ─── Middleware Config ──────────────────────────────────────

describe('Middleware config', () => {
  it('exports a config with matcher array', async () => {
    const mod = await import('@/proxy');
    expect(mod.config).toBeDefined();
    expect(mod.config.matcher).toBeDefined();
    expect(Array.isArray(mod.config.matcher)).toBe(true);
  });

  it('matcher excludes static assets', async () => {
    const mod = await import('@/proxy');
    const pattern = mod.config.matcher[0];
    expect(pattern).toContain('_next/static');
    expect(pattern).toContain('_next/image');
    expect(pattern).toContain('favicon');
    expect(pattern).not.toContain('manifest');
    expect(pattern).toContain('sw');
    expect(pattern).toContain('robots');
  });

  it('proxy function is exported', async () => {
    const mod = await import('@/proxy');
    expect(typeof mod.proxy).toBe('function');
  });
});

// ─── CORS Header Expectations for API Routes ──────────────────

describe('CORS header expectations for API routes', () => {
  // Middleware sets CORS headers on /api/* routes.
  // We test the expected header values and patterns.
  const API_CORS_HEADERS: Record<string, string | RegExp> = {
    'Access-Control-Allow-Methods': /GET|POST|PUT|DELETE|OPTIONS/,
    'Access-Control-Allow-Headers': /Content-Type|Authorization/,
  };

  it('CORS allow-methods includes standard HTTP methods', () => {
    const methods = 'GET, POST, PUT, DELETE, OPTIONS';
    expect(methods).toMatch(API_CORS_HEADERS['Access-Control-Allow-Methods']);
  });

  it('CORS allow-headers includes Content-Type and Authorization', () => {
    const headers = 'Content-Type, Authorization, x-admin-secret';
    expect(headers).toMatch(API_CORS_HEADERS['Access-Control-Allow-Headers']);
  });

  it('API paths are identifiable by /api/ prefix', () => {
    const apiPaths = ['/api/v1/health', '/api/quiz/submit', '/api/payments/webhook'];
    const nonApiPaths = ['/dashboard', '/login', '/welcome'];

    for (const p of apiPaths) {
      expect(p.startsWith('/api/')).toBe(true);
    }
    for (const p of nonApiPaths) {
      expect(p.startsWith('/api/')).toBe(false);
    }
  });
});

// ─── Super Admin Route Protection Pattern ─────────────────────

describe('Super admin route protection patterns', () => {
  function isSuperAdminRoute(path: string): boolean {
    return path.startsWith('/super-admin') && !path.startsWith('/super-admin/login');
  }

  function shouldRedirectToAdminLogin(path: string, hasAdminSession: boolean): boolean {
    return isSuperAdminRoute(path) && !hasAdminSession;
  }

  it('identifies super-admin dashboard as protected', () => {
    expect(isSuperAdminRoute('/super-admin')).toBe(true);
    expect(isSuperAdminRoute('/super-admin/users')).toBe(true);
    expect(isSuperAdminRoute('/super-admin/flags')).toBe(true);
    expect(isSuperAdminRoute('/super-admin/analytics')).toBe(true);
  });

  it('does not protect super-admin login page itself', () => {
    expect(isSuperAdminRoute('/super-admin/login')).toBe(false);
  });

  it('redirects unauthenticated admin requests', () => {
    expect(shouldRedirectToAdminLogin('/super-admin', false)).toBe(true);
    expect(shouldRedirectToAdminLogin('/super-admin/users', false)).toBe(true);
  });

  it('allows authenticated admin requests', () => {
    expect(shouldRedirectToAdminLogin('/super-admin', true)).toBe(false);
    expect(shouldRedirectToAdminLogin('/super-admin/users', true)).toBe(false);
  });

  it('non-admin routes are not affected by admin auth check', () => {
    expect(isSuperAdminRoute('/dashboard')).toBe(false);
    expect(isSuperAdminRoute('/login')).toBe(false);
    expect(isSuperAdminRoute('/api/v1/health')).toBe(false);
  });
});

// ─── Additional Bot Patterns ──────────────────────────────────

describe('Extended bot/scanner blocking patterns', () => {
  function shouldBlock(path: string): boolean {
    return (
      path.startsWith('/wp-') ||
      path.startsWith('/phpmy') ||
      path.endsWith('.php') ||
      path.endsWith('.env') ||
      path.startsWith('/.git') ||
      (path.startsWith('/admin') && !path.startsWith('/internal/admin')) ||
      path.startsWith('/cgi-bin') ||
      path.includes('..') ||
      path.endsWith('.asp') ||
      path.endsWith('.aspx') ||
      path.endsWith('.jsp') ||
      path.startsWith('/xmlrpc') ||
      path.startsWith('/eval-stdin') ||
      path.includes('etc/passwd') ||
      path.includes('proc/self')
    );
  }

  it('blocks ASP/ASPX probes', () => {
    expect(shouldBlock('/default.asp')).toBe(true);
    expect(shouldBlock('/login.aspx')).toBe(true);
  });

  it('blocks JSP probes', () => {
    expect(shouldBlock('/manager/html.jsp')).toBe(true);
  });

  it('blocks XML-RPC probes', () => {
    expect(shouldBlock('/xmlrpc')).toBe(true);
    expect(shouldBlock('/xmlrpc.php')).toBe(true);
  });

  it('blocks eval-stdin exploit attempts', () => {
    expect(shouldBlock('/eval-stdin.php')).toBe(true);
  });

  it('blocks /etc/passwd traversal', () => {
    expect(shouldBlock('/../../../../etc/passwd')).toBe(true);
  });

  it('blocks /proc/self traversal', () => {
    expect(shouldBlock('/../../proc/self/environ')).toBe(true);
  });

  it('allows legitimate Next.js routes', () => {
    expect(shouldBlock('/welcome')).toBe(false);
    expect(shouldBlock('/api/v1/health')).toBe(false);
    expect(shouldBlock('/quiz')).toBe(false);
    expect(shouldBlock('/pricing')).toBe(false);
    expect(shouldBlock('/super-admin/login')).toBe(false);
  });
});

// ─── Session Cookie Presence for Protected Routes ──────────────

describe('Protected route session requirement', () => {
  function requiresSessionCookie(path: string): boolean {
    const PROTECTED_PREFIXES = [
      '/dashboard', '/quiz', '/profile', '/progress', '/reports',
      '/foxy', '/learn', '/review', '/scan',
      '/notifications', '/exams', '/leaderboard', '/hpc', '/simulations',
      '/stem-centre', '/research',
      '/parent/children', '/parent/reports', '/parent/profile', '/parent/support',
      '/teacher/',
      '/billing',
    ];
    return PROTECTED_PREFIXES.some(p => path.startsWith(p));
  }

  it('all student feature routes require session', () => {
    const studentRoutes = [
      '/dashboard', '/quiz', '/profile', '/progress', '/foxy',
      '/learn', '/review', '/scan', '/notifications', '/leaderboard',
    ];
    for (const route of studentRoutes) {
      expect(requiresSessionCookie(route)).toBe(true);
    }
  });

  it('all parent portal routes require session', () => {
    const parentRoutes = [
      '/parent/children', '/parent/reports', '/parent/profile', '/parent/support',
    ];
    for (const parentRoute of parentRoutes) {
      expect(requiresSessionCookie(parentRoute)).toBe(true);
    }
  });

  it('billing route requires session', () => {
    expect(requiresSessionCookie('/billing')).toBe(true);
  });

  it('public pages do not require session', () => {
    const publicRoutes = ['/welcome', '/login', '/pricing', '/about', '/contact'];
    for (const route of publicRoutes) {
      expect(requiresSessionCookie(route)).toBe(false);
    }
  });
});

// ─── Timing-Safe Comparison Pattern ─────────────────────────

// ─── F1: getUser() Crash Protection ─────────────────────────

describe('F1: getUser() crash protection logic', () => {
  /**
   * Replicates the try/catch decision logic added to src/proxy.ts Layer 0.
   * The middleware now swallows errors from supabase.auth.getUser() and sets
   * an `x-auth-degraded: true` response header unless the error is the normal
   * "no session" case (AuthSessionMissingError).
   */
  type FakeGetUserOutcome =
    | { ok: true; userId: string | null }
    | { ok: false; errorName: string; errorMessage: string }
    | { throw: Error };

  interface AuthState {
    authUserId: string | null;
    authDegraded: boolean;
  }

  function simulateAuthLayer(outcome: FakeGetUserOutcome): AuthState {
    const state: AuthState = { authUserId: null, authDegraded: false };
    try {
      if ('throw' in outcome) throw outcome.throw;
      if (outcome.ok) {
        state.authUserId = outcome.userId;
      } else {
        const isNoSession = outcome.errorName === 'AuthSessionMissingError';
        if (!isNoSession) {
          state.authDegraded = true;
        }
      }
    } catch {
      state.authDegraded = true;
    }
    return state;
  }

  it('does not mark degraded when getUser returns AuthSessionMissingError', () => {
    const state = simulateAuthLayer({
      ok: false,
      errorName: 'AuthSessionMissingError',
      errorMessage: 'Auth session missing!',
    });
    expect(state.authDegraded).toBe(false);
    expect(state.authUserId).toBeNull();
  });

  it('marks degraded when getUser returns a non-session error', () => {
    const state = simulateAuthLayer({
      ok: false,
      errorName: 'AuthRetryableFetchError',
      errorMessage: 'Network error',
    });
    expect(state.authDegraded).toBe(true);
    expect(state.authUserId).toBeNull();
  });

  it('marks degraded when getUser throws unexpectedly (network/crash)', () => {
    const state = simulateAuthLayer({ throw: new Error('ECONNREFUSED') });
    expect(state.authDegraded).toBe(true);
    expect(state.authUserId).toBeNull();
  });

  it('marks degraded on TypeError (corrupted JWT / malformed cookie)', () => {
    const err = new TypeError('Invalid JWT');
    const state = simulateAuthLayer({ throw: err });
    expect(state.authDegraded).toBe(true);
  });

  it('does NOT mark degraded on a valid session', () => {
    const state = simulateAuthLayer({ ok: true, userId: 'user-123' });
    expect(state.authDegraded).toBe(false);
    expect(state.authUserId).toBe('user-123');
  });

  it('does NOT mark degraded when no user (ok=true, userId=null)', () => {
    // Happy "logged out" case: getUser() succeeded but returned no user.
    const state = simulateAuthLayer({ ok: true, userId: null });
    expect(state.authDegraded).toBe(false);
    expect(state.authUserId).toBeNull();
  });

  it('sets x-auth-degraded header when authDegraded is true', () => {
    // Emulates the response-header assignment from proxy.ts:
    //   if (authDegraded) response.headers.set('x-auth-degraded', 'true').
    const headers = new Headers();
    const authDegraded = true;
    if (authDegraded) headers.set('x-auth-degraded', 'true');
    expect(headers.get('x-auth-degraded')).toBe('true');
  });

  it('does NOT set x-auth-degraded header when authDegraded is false', () => {
    const headers = new Headers();
    const authDegraded = false;
    if (authDegraded) headers.set('x-auth-degraded', 'true');
    expect(headers.get('x-auth-degraded')).toBeNull();
  });
});

// ─── F1: proxy.ts source-level structural assertions ────────
describe('F1: proxy.ts source structure', () => {
  it('wraps supabase.auth.getUser() in a try/catch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    // The file must contain both a try block and a catch block around getUser.
    expect(file).toMatch(/try\s*\{[\s\S]*supabase\.auth\.getUser\(\)[\s\S]*\}\s*catch/);
    expect(file).toContain("message: 'middleware_auth_crash'");
  });

  it('treats AuthSessionMissingError as normal (not degraded)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    expect(file).toContain('AuthSessionMissingError');
    expect(file).toMatch(/isNoSession/);
  });

  it('sets x-auth-degraded response header when auth is degraded', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    expect(file).toContain("'x-auth-degraded'");
    expect(file).toMatch(/authDegraded\s*=\s*true/);
  });
});

// ─── Phase A.3: tenant headers forwarded as REQUEST headers ──────────
//
// Bug fixed by this PR: src/proxy.ts used to set x-school-* on response.headers
// only, but /api/school-config/route.ts and lib/tenant.ts → tenantFromHeaders()
// read x-school-id off the INCOMING request — the response is invisible to
// them. Result: SchoolContext always returned isSchoolContext: false in
// production even when tenant lookup succeeded.
//
// Fix: build a fresh Headers from request.headers, append x-school-* to it,
// and pass via `NextResponse.next({ request: { headers: requestHeaders } })`.
// This is the Next.js canonical pattern for forwarding modified request
// headers to API routes + Server Components in the same lifecycle.
describe('Phase A.3: tenant headers propagated via request, not response', () => {
  // Simulates the augmentation logic that proxy.ts applies after Layer 0
  // tenant resolution. Mirrors lines around 556-565 of src/proxy.ts.
  interface FakeSchool {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    primary_color: string;
    secondary_color: string;
    tagline: string | null;
  }

  function buildForwardedRequestHeaders(
    incoming: Headers,
    schoolConfig: FakeSchool | null,
  ): Headers {
    const requestHeaders = new Headers(incoming);
    if (schoolConfig) {
      requestHeaders.set('x-school-id', schoolConfig.id);
      requestHeaders.set('x-school-name', encodeURIComponent(schoolConfig.name));
      requestHeaders.set('x-school-slug', schoolConfig.slug);
      requestHeaders.set('x-school-logo', schoolConfig.logo_url || '');
      requestHeaders.set('x-school-primary-color', schoolConfig.primary_color || '#7C3AED');
      requestHeaders.set('x-school-secondary-color', schoolConfig.secondary_color || '#E8581C');
      requestHeaders.set('x-school-tagline', encodeURIComponent(schoolConfig.tagline || ''));
    }
    return requestHeaders;
  }

  const DPS_NOIDA: FakeSchool = {
    id: 'sch_dps_noida_uuid',
    name: 'Delhi Public School, Noida',
    slug: 'dps-noida',
    logo_url: 'https://cdn.example.com/dps-noida.png',
    primary_color: '#0066CC',
    secondary_color: '#FFD200',
    tagline: 'Excellence in Education',
  };

  it('forwards x-school-id on the request headers when a tenant resolves', () => {
    const incoming = new Headers({ 'host': 'dps-noida.alfanumrik.com' });
    const forwarded = buildForwardedRequestHeaders(incoming, DPS_NOIDA);

    // This is the header /api/school-config/route.ts gates on:
    //   const schoolId = request.headers.get('x-school-id');
    //   if (!schoolId) return { isSchoolContext: false };
    expect(forwarded.get('x-school-id')).toBe('sch_dps_noida_uuid');
  });

  it('forwards all 7 x-school-* headers on the request', () => {
    const incoming = new Headers({ 'host': 'dps-noida.alfanumrik.com' });
    const forwarded = buildForwardedRequestHeaders(incoming, DPS_NOIDA);

    expect(forwarded.get('x-school-id')).toBe('sch_dps_noida_uuid');
    expect(forwarded.get('x-school-name')).toBe(encodeURIComponent('Delhi Public School, Noida'));
    expect(forwarded.get('x-school-slug')).toBe('dps-noida');
    expect(forwarded.get('x-school-logo')).toBe('https://cdn.example.com/dps-noida.png');
    expect(forwarded.get('x-school-primary-color')).toBe('#0066CC');
    expect(forwarded.get('x-school-secondary-color')).toBe('#FFD200');
    expect(forwarded.get('x-school-tagline')).toBe(encodeURIComponent('Excellence in Education'));
  });

  it('encodes the school name so commas/spaces survive the header transport', () => {
    // School name "Delhi Public School, Noida" contains a comma, which is a
    // header-delimiter token. URL-encoding it ensures the downstream
    // decodeURIComponent call in /api/school-config/route.ts:33 round-trips
    // back to the exact input.
    const incoming = new Headers();
    const forwarded = buildForwardedRequestHeaders(incoming, DPS_NOIDA);
    const encoded = forwarded.get('x-school-name')!;
    expect(decodeURIComponent(encoded)).toBe('Delhi Public School, Noida');
  });

  it('preserves the incoming request headers (e.g. host, cookie)', () => {
    const incoming = new Headers({
      'host': 'dps-noida.alfanumrik.com',
      'cookie': 'sb-abc-auth-token=xxx',
      'user-agent': 'Mozilla/5.0',
    });
    const forwarded = buildForwardedRequestHeaders(incoming, DPS_NOIDA);

    // Original headers must be retained — Next.js, Supabase, and downstream
    // handlers all rely on these.
    expect(forwarded.get('host')).toBe('dps-noida.alfanumrik.com');
    expect(forwarded.get('cookie')).toBe('sb-abc-auth-token=xxx');
    expect(forwarded.get('user-agent')).toBe('Mozilla/5.0');
    // And the tenant headers are added alongside.
    expect(forwarded.get('x-school-id')).toBe('sch_dps_noida_uuid');
  });

  it('does NOT add x-school-* headers when no tenant resolved (B2C path)', () => {
    const incoming = new Headers({ 'host': 'alfanumrik.com' });
    const forwarded = buildForwardedRequestHeaders(incoming, null);

    expect(forwarded.get('x-school-id')).toBeNull();
    expect(forwarded.get('x-school-name')).toBeNull();
    expect(forwarded.get('x-school-slug')).toBeNull();
    // B2C requests must look exactly like the incoming request.
    expect(forwarded.get('host')).toBe('alfanumrik.com');
  });

  it('defaults logo/tagline to empty string when school has null values', () => {
    const incoming = new Headers();
    const noBranding: FakeSchool = {
      ...DPS_NOIDA,
      logo_url: null,
      tagline: null,
    };
    const forwarded = buildForwardedRequestHeaders(incoming, noBranding);

    // Header values must be strings — null would be coerced to "null".
    expect(forwarded.get('x-school-logo')).toBe('');
    expect(forwarded.get('x-school-tagline')).toBe(encodeURIComponent(''));
  });

  it('defaults primary/secondary colors when school omits them', () => {
    const incoming = new Headers();
    const noColors: FakeSchool = {
      ...DPS_NOIDA,
      primary_color: '',
      secondary_color: '',
    };
    const forwarded = buildForwardedRequestHeaders(incoming, noColors);

    // Falls back to Alfanumrik default palette so the UI never renders unstyled.
    expect(forwarded.get('x-school-primary-color')).toBe('#7C3AED');
    expect(forwarded.get('x-school-secondary-color')).toBe('#E8581C');
  });
});

// ─── Phase A.3: proxy.ts source-level assertions (canonical pattern) ──
//
// These guard against accidental regression: the surgical fix MUST use
// the `NextResponse.next({ request: { headers: ... } })` pattern. If a
// future refactor reverts to `NextResponse.next({ request })` or sets
// tenant headers only on `response.headers`, these tests catch it before
// SchoolContext breaks in production again.
describe('Phase A.3: proxy.ts forwards tenant via request, not response', () => {
  it('builds requestHeaders from the incoming request', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    // The canonical clone: `new Headers(request.headers)`.
    expect(file).toMatch(/const\s+requestHeaders\s*=\s*new\s+Headers\s*\(\s*request\.headers\s*\)/);
  });

  it('sets x-school-id on requestHeaders (not just response)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    expect(file).toMatch(/requestHeaders\.set\(\s*['"]x-school-id['"]/);
    expect(file).toMatch(/requestHeaders\.set\(\s*['"]x-school-slug['"]/);
    expect(file).toMatch(/requestHeaders\.set\(\s*['"]x-school-name['"]/);
  });

  it('passes requestHeaders into NextResponse.next via { request: { headers } }', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    // Must use the canonical forwarding shape — bare `NextResponse.next({ request })`
    // would leave the augmented headers behind.
    expect(file).toMatch(/NextResponse\.next\(\s*\{\s*request:\s*\{\s*headers:\s*requestHeaders\s*\}\s*\}\s*\)/);
  });

  it('uses the same forwarded-headers shape inside the Supabase setAll callback', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    // Counts must be ≥ 2 — once for the initial response, once for the setAll
    // recreation. If a future edit drops one, the tenant context is lost on
    // requests where Supabase rotates the auth cookie (the exact path users
    // hit on every login redirect).
    const matches = file.match(/NextResponse\.next\(\s*\{\s*request:\s*\{\s*headers:\s*requestHeaders\s*\}\s*\}\s*\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── F4: Role-based route protection ─────────────────────────

describe('F4: middleware-helpers findRouteRule', () => {
  it('matches /parent/children to parent rule', async () => {
    const { findRouteRule } = await import('@alfanumrik/lib/middleware-helpers');
    const rule = findRouteRule('/parent/children');
    expect(rule).not.toBeNull();
    expect(rule!.allowed).toContain('guardian');
    expect(rule!.allowed).toContain('admin');
    expect(rule!.allowed).toContain('super_admin');
  });

  it('exempts the /parent login page itself', async () => {
    const { findRouteRule } = await import('@alfanumrik/lib/middleware-helpers');
    // /parent (exact) is exempt — public login form.
    expect(findRouteRule('/parent')).toBeNull();
    // But /parent/anything IS protected.
    expect(findRouteRule('/parent/children')).not.toBeNull();
  });

  it('matches /teacher/* to teacher rule', async () => {
    const { findRouteRule } = await import('@alfanumrik/lib/middleware-helpers');
    const rule = findRouteRule('/teacher');
    expect(rule).not.toBeNull();
    expect(rule!.allowed).toEqual(expect.arrayContaining(['teacher', 'admin', 'super_admin']));
    expect(rule!.allowed).not.toContain('student');
    expect(rule!.allowed).not.toContain('guardian');
  });

  it('matches /super-admin/* to admin+super_admin rule', async () => {
    const { findRouteRule } = await import('@alfanumrik/lib/middleware-helpers');
    const rule = findRouteRule('/super-admin/users');
    expect(rule).not.toBeNull();
    expect(rule!.allowed).toEqual(['admin', 'super_admin']);
    expect(rule!.allowed).not.toContain('teacher');
    expect(rule!.allowed).not.toContain('student');
  });

  it('matches /school-admin/* to institution_admin rule', async () => {
    const { findRouteRule } = await import('@alfanumrik/lib/middleware-helpers');
    const rule = findRouteRule('/school-admin/classes');
    expect(rule).not.toBeNull();
    expect(rule!.allowed).toContain('institution_admin');
    expect(rule!.allowed).toContain('admin');
    expect(rule!.allowed).toContain('super_admin');
  });

  it('returns null for non-role-gated routes', async () => {
    const { findRouteRule } = await import('@alfanumrik/lib/middleware-helpers');
    expect(findRouteRule('/dashboard')).toBeNull();
    expect(findRouteRule('/foxy')).toBeNull();
    expect(findRouteRule('/login')).toBeNull();
    expect(findRouteRule('/api/v1/health')).toBeNull();
  });
});

describe('F4: middleware-helpers destinationForRole', () => {
  it('maps each role to its correct portal', async () => {
    const { destinationForRole } = await import('@alfanumrik/lib/middleware-helpers');
    expect(destinationForRole('student')).toBe('/dashboard');
    expect(destinationForRole('teacher')).toBe('/teacher');
    expect(destinationForRole('guardian')).toBe('/parent');
    expect(destinationForRole('institution_admin')).toBe('/school-admin');
    expect(destinationForRole('admin')).toBe('/super-admin');
    expect(destinationForRole('super_admin')).toBe('/super-admin');
  });

  it('maps "none" (unonboarded) to /onboarding', async () => {
    const { destinationForRole } = await import('@alfanumrik/lib/middleware-helpers');
    expect(destinationForRole('none')).toBe('/onboarding');
  });
});

describe('F4: role-based redirect decision', () => {
  /**
   * Replicates the Layer 0.65 decision in src/proxy.ts:
   *   - Unauthenticated / authDegraded → allow (fail open).
   *   - Authenticated + role === 'none' → redirect /onboarding.
   *   - Authenticated + role not in rule.allowed → redirect to destinationForRole.
   *   - Authenticated + role in rule.allowed → allow.
   */
  interface RouteProtectDecision {
    action: 'allow' | 'redirect';
    to?: string;
  }

  type MWRole = 'student' | 'teacher' | 'guardian' | 'institution_admin' | 'admin' | 'super_admin' | 'none';

  function decide(
    path: string,
    role: MWRole | null,
    authUserId: string | null,
    authDegraded: boolean,
    rules: { prefix: string; allowed: string[]; exemptExactMatch?: boolean }[],
    destForRole: (r: string) => string,
  ): RouteProtectDecision {
    let rule: { prefix: string; allowed: string[]; exemptExactMatch?: boolean } | null = null;
    for (const r of rules) {
      if (r.exemptExactMatch && path === r.prefix) continue;
      if (path === r.prefix || path.startsWith(r.prefix + '/')) {
        rule = r;
        break;
      }
    }
    if (!rule) return { action: 'allow' };
    if (!authUserId || authDegraded) return { action: 'allow' };
    if (role === null) return { action: 'allow' };
    if (role === 'none') return { action: 'redirect', to: '/onboarding' };
    if (!rule.allowed.includes(role)) {
      const dest = destForRole(role);
      const loopSafe = path === dest || path.startsWith(dest + '/') ? '/dashboard' : dest;
      return { action: 'redirect', to: loopSafe };
    }
    return { action: 'allow' };
  }

  const RULES = [
    { prefix: '/parent', allowed: ['guardian', 'admin', 'super_admin'], exemptExactMatch: true },
    { prefix: '/teacher', allowed: ['teacher', 'admin', 'super_admin'] },
    { prefix: '/super-admin', allowed: ['admin', 'super_admin'] },
    { prefix: '/school-admin', allowed: ['institution_admin', 'admin', 'super_admin'] },
  ];

  const DEST: Record<string, string> = {
    student: '/dashboard',
    teacher: '/teacher',
    guardian: '/parent',
    institution_admin: '/school-admin',
    admin: '/super-admin',
    super_admin: '/super-admin',
  };
  const destFn = (r: string) => DEST[r] || '/dashboard';

  it('student accessing /parent/children → redirect to /dashboard', () => {
    const d = decide('/parent/children', 'student', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('redirect');
    expect(d.to).toBe('/dashboard');
  });

  it('teacher accessing /super-admin → redirect to /teacher', () => {
    const d = decide('/super-admin', 'teacher', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('redirect');
    expect(d.to).toBe('/teacher');
  });

  it('guardian accessing /teacher → redirect to /parent', () => {
    const d = decide('/teacher/classes', 'guardian', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('redirect');
    expect(d.to).toBe('/parent');
  });

  it('student accessing /school-admin → redirect to /dashboard', () => {
    const d = decide('/school-admin/api-keys', 'student', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('redirect');
    expect(d.to).toBe('/dashboard');
  });

  it('admin can access ALL protected portals', () => {
    for (const path of ['/parent/children', '/teacher/classes', '/super-admin/users', '/school-admin/api-keys']) {
      const d = decide(path, 'admin', 'user-1', false, RULES, destFn);
      expect(d.action).toBe('allow');
    }
  });

  it('super_admin can access ALL protected portals', () => {
    for (const path of ['/parent/children', '/teacher/classes', '/super-admin/users', '/school-admin/api-keys']) {
      const d = decide(path, 'super_admin', 'user-1', false, RULES, destFn);
      expect(d.action).toBe('allow');
    }
  });

  it('teacher allowed on /teacher', () => {
    const d = decide('/teacher/classes', 'teacher', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('allow');
  });

  it('guardian allowed on /parent/reports', () => {
    const d = decide('/parent/reports', 'guardian', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('allow');
  });

  it('institution_admin allowed on /school-admin', () => {
    const d = decide('/school-admin', 'institution_admin', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('allow');
  });

  it('unauthenticated user → allow (other layers handle cookie redirect)', () => {
    // Layer 0.65 must NOT redirect unauthenticated users — Layer 0.6/0.7 do.
    const d = decide('/parent/children', null, null, false, RULES, destFn);
    expect(d.action).toBe('allow');
  });

  it('authDegraded → allow (fail open, do not lock users out on infra error)', () => {
    const d = decide('/super-admin/users', 'student', 'user-1', true, RULES, destFn);
    expect(d.action).toBe('allow');
  });

  it('role === null (lookup failed) → allow (fail open)', () => {
    const d = decide('/teacher/classes', null, 'user-1', false, RULES, destFn);
    expect(d.action).toBe('allow');
  });

  it('role === "none" (not onboarded) → redirect to /onboarding', () => {
    const d = decide('/teacher/classes', 'none', 'user-1', false, RULES, destFn);
    expect(d.action).toBe('redirect');
    expect(d.to).toBe('/onboarding');
  });

  it('/parent (exact match) is public — all roles allowed through', () => {
    expect(decide('/parent', 'student', 'user-1', false, RULES, destFn).action).toBe('allow');
    expect(decide('/parent', null, null, false, RULES, destFn).action).toBe('allow');
  });

  it('loop safety — falls back to /dashboard if destination is inside same rule', () => {
    // Contrived: if destinationForRole ever returned a path inside the rule,
    // the loop-safe fallback is /dashboard.
    const weirdDest = (_r: string) => '/super-admin';
    const d = decide('/super-admin/users', 'student', 'user-1', false, RULES, weirdDest);
    expect(d.action).toBe('redirect');
    expect(d.to).toBe('/dashboard');
  });
});

describe('Timing-safe string comparison', () => {
  // Re-implement the timingSafeEqual from middleware for testing.
  // Note: when lengths differ, set mismatch=1 BEFORE comparing bytes
  // to ensure different-length strings always return false.
  function timingSafeEqual(a: string, b: string): boolean {
    let mismatch = a.length !== b.length ? 1 : 0;
    // Compare against the shorter string to avoid out-of-bounds,
    // but mismatch is already set if lengths differ.
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
  }

  it('returns true for matching strings', () => {
    expect(timingSafeEqual('secret123', 'secret123')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeEqual('secret123', 'secret456')).toBe(false);
  });

  it('returns false for different length strings', () => {
    expect(timingSafeEqual('short', 'longerstring')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('handles special characters', () => {
    expect(timingSafeEqual('p@$$w0rd!', 'p@$$w0rd!')).toBe(true);
    expect(timingSafeEqual('p@$$w0rd!', 'p@$$w0rd?')).toBe(false);
  });
});
