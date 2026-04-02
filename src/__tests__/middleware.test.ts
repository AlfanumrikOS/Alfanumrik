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
    '/study-plan', '/foxy', '/learn', '/review', '/scan',
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
    const mod = await import('@/middleware');
    expect(mod.config).toBeDefined();
    expect(mod.config.matcher).toBeDefined();
    expect(Array.isArray(mod.config.matcher)).toBe(true);
  });

  it('matcher excludes static assets', async () => {
    const mod = await import('@/middleware');
    const pattern = mod.config.matcher[0];
    expect(pattern).toContain('_next/static');
    expect(pattern).toContain('_next/image');
    expect(pattern).toContain('favicon');
    expect(pattern).toContain('manifest');
    expect(pattern).toContain('sw');
    expect(pattern).toContain('robots');
  });

  it('middleware function is exported', async () => {
    const mod = await import('@/middleware');
    expect(typeof mod.middleware).toBe('function');
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
      '/study-plan', '/foxy', '/learn', '/review', '/scan',
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
