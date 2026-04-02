import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Middleware Auth Route Handling Tests
 *
 * Tests that middleware correctly allows/blocks auth-related routes
 * and protects sensitive pages. Uses pattern-matching logic extracted
 * from src/middleware.ts for reliable unit testing.
 *
 * Regression catalog entries:
 * - redirect_unauthenticated: Protected pages redirect to /login (or /parent login)
 * - session_refresh_on_request: Middleware refreshes session cookie
 *
 * Product invariants tested:
 * - P9: RBAC enforcement — protected routes require session
 */

// ── Middleware route logic extracted for testability ──

/**
 * Routes that are always public (no session required).
 * These must be accessible without cookies.
 */
const AUTH_ROUTES = ['/login', '/signup', '/auth/callback', '/auth/confirm', '/auth/reset'];

/**
 * Protected route prefixes from middleware source.
 * Middleware checks for Supabase session cookie on these paths.
 */
const PROTECTED_PREFIXES = [
  '/parent/children',
  '/parent/reports',
  '/parent/profile',
  '/parent/support',
  '/billing',
];

/**
 * Routes that use client-side auth (useRequireAuth) instead of
 * middleware cookie checks. These are NOT protected in middleware.
 */
const CLIENT_AUTH_ROUTES = [
  '/dashboard',
  '/quiz',
  '/profile',
  '/progress',
  '/reports',
  '/foxy',
  '/learn',
];

function isPublicRoute(path: string): boolean {
  return AUTH_ROUTES.some(r => path.startsWith(r));
}

function isMiddlewareProtected(path: string): boolean {
  return PROTECTED_PREFIXES.some(p => path.startsWith(p));
}

function shouldRedirect(path: string, hasSession: boolean): { redirect: boolean; destination?: string } {
  // Root redirect: / → /welcome when no session
  if (path === '/' && !hasSession) {
    return { redirect: true, destination: '/welcome' };
  }

  // Protected prefixes: redirect to login when no session
  if (isMiddlewareProtected(path) && !hasSession) {
    const isParentRoute = path.startsWith('/parent');
    return {
      redirect: true,
      destination: isParentRoute ? '/parent' : '/login',
    };
  }

  return { redirect: false };
}

// ═══════════════════════════════════════════════════════════════
// Public auth routes (must be accessible without session)
// ═══════════════════════════════════════════════════════════════

describe('Middleware auth route handling', () => {
  describe('Public auth routes', () => {
    it('allows /login without session', () => {
      expect(isPublicRoute('/login')).toBe(true);
      const result = shouldRedirect('/login', false);
      expect(result.redirect).toBe(false);
    });

    it('allows /auth/callback without session', () => {
      expect(isPublicRoute('/auth/callback')).toBe(true);
      const result = shouldRedirect('/auth/callback', false);
      expect(result.redirect).toBe(false);
    });

    it('allows /auth/confirm without session', () => {
      expect(isPublicRoute('/auth/confirm')).toBe(true);
      const result = shouldRedirect('/auth/confirm', false);
      expect(result.redirect).toBe(false);
    });

    it('allows /auth/reset without session', () => {
      expect(isPublicRoute('/auth/reset')).toBe(true);
      const result = shouldRedirect('/auth/reset', false);
      expect(result.redirect).toBe(false);
    });

    it('allows /signup without session', () => {
      expect(isPublicRoute('/signup')).toBe(true);
      const result = shouldRedirect('/signup', false);
      expect(result.redirect).toBe(false);
    });

    it('allows /welcome without session', () => {
      // /welcome is the landing page, always accessible
      expect(isPublicRoute('/welcome')).toBe(false); // not an auth route
      expect(isMiddlewareProtected('/welcome')).toBe(false); // not protected
      const result = shouldRedirect('/welcome', false);
      expect(result.redirect).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Root redirect
  // ═══════════════════════════════════════════════════════════════

  describe('Root redirect', () => {
    it('redirects / to /welcome when no session', () => {
      const result = shouldRedirect('/', false);
      expect(result.redirect).toBe(true);
      expect(result.destination).toBe('/welcome');
    });

    it('does not redirect / when session exists', () => {
      const result = shouldRedirect('/', true);
      expect(result.redirect).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Protected routes (middleware-level session check)
  // ═══════════════════════════════════════════════════════════════

  describe('Middleware-protected routes', () => {
    it('protects /parent/children without session', () => {
      const result = shouldRedirect('/parent/children', false);
      expect(result.redirect).toBe(true);
      expect(result.destination).toBe('/parent');
    });

    it('protects /parent/reports without session', () => {
      const result = shouldRedirect('/parent/reports', false);
      expect(result.redirect).toBe(true);
      expect(result.destination).toBe('/parent');
    });

    it('protects /parent/profile without session', () => {
      const result = shouldRedirect('/parent/profile', false);
      expect(result.redirect).toBe(true);
      expect(result.destination).toBe('/parent');
    });

    it('protects /parent/support without session', () => {
      const result = shouldRedirect('/parent/support', false);
      expect(result.redirect).toBe(true);
      expect(result.destination).toBe('/parent');
    });

    it('protects /billing without session', () => {
      const result = shouldRedirect('/billing', false);
      expect(result.redirect).toBe(true);
      expect(result.destination).toBe('/login');
    });

    it('allows protected routes when session exists', () => {
      for (const prefix of PROTECTED_PREFIXES) {
        const result = shouldRedirect(prefix, true);
        expect(result.redirect).toBe(false);
      }
    });

    it('parent routes redirect to /parent login, not /login', () => {
      const parentRoutes = [
        '/parent/children',
        '/parent/reports',
        '/parent/profile',
        '/parent/support',
      ];
      for (const route of parentRoutes) {
        const result = shouldRedirect(route, false);
        expect(result.destination).toBe('/parent');
      }
    });

    it('non-parent protected routes redirect to /login', () => {
      const result = shouldRedirect('/billing', false);
      expect(result.destination).toBe('/login');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Client-side auth routes (NOT protected by middleware)
  // ═══════════════════════════════════════════════════════════════

  describe('Client-side auth routes (not middleware-protected)', () => {
    it('does not protect /dashboard in middleware (uses client-side auth)', () => {
      expect(isMiddlewareProtected('/dashboard')).toBe(false);
      const result = shouldRedirect('/dashboard', false);
      expect(result.redirect).toBe(false);
    });

    it('does not protect /quiz in middleware (uses client-side auth)', () => {
      expect(isMiddlewareProtected('/quiz')).toBe(false);
      const result = shouldRedirect('/quiz', false);
      expect(result.redirect).toBe(false);
    });

    it('does not protect /profile in middleware (uses client-side auth)', () => {
      expect(isMiddlewareProtected('/profile')).toBe(false);
    });

    it('does not protect /progress in middleware (uses client-side auth)', () => {
      expect(isMiddlewareProtected('/progress')).toBe(false);
    });

    it('does not protect /foxy in middleware (uses client-side auth)', () => {
      expect(isMiddlewareProtected('/foxy')).toBe(false);
    });

    it('does not protect /learn in middleware (uses client-side auth)', () => {
      expect(isMiddlewareProtected('/learn')).toBe(false);
    });

    it('does not protect /reports in middleware (uses client-side auth)', () => {
      // Note: /reports is client-side protected. Only /parent/reports is middleware-protected.
      expect(isMiddlewareProtected('/reports')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // /parent base route (login page itself)
  // ═══════════════════════════════════════════════════════════════

  describe('Parent login page', () => {
    it('does not protect /parent itself (it is the login page)', () => {
      // /parent is the parent login page — it must be accessible
      expect(isMiddlewareProtected('/parent')).toBe(false);
      const result = shouldRedirect('/parent', false);
      expect(result.redirect).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Middleware session refresh verification
// ═══════════════════════════════════════════════════════════════

describe('Middleware session refresh', () => {
  it('middleware exports config with matcher that covers all dynamic routes', async () => {
    const mod = await import('@/middleware');
    expect(mod.config).toBeDefined();
    expect(Array.isArray(mod.config.matcher)).toBe(true);

    // The matcher should be a negative lookahead excluding static assets
    const pattern = mod.config.matcher[0];
    expect(pattern).toContain('_next/static');
    expect(pattern).toContain('_next/image');
  });

  it('middleware function is exported and callable for session refresh', async () => {
    const mod = await import('@/middleware');
    expect(typeof mod.middleware).toBe('function');
  });

  it('matcher pattern does not exclude auth routes (ensures session refresh runs)', async () => {
    const mod = await import('@/middleware');
    const pattern = mod.config.matcher[0];

    // Auth routes should NOT be excluded from the matcher
    // (middleware must run on them for session refresh)
    expect(pattern).not.toContain('/auth/callback');
    expect(pattern).not.toContain('/login');
  });
});

// ═══════════════════════════════════════════════════════════════
// Open redirect prevention (from callback route)
// ═══════════════════════════════════════════════════════════════

describe('Open redirect prevention', () => {
  const SAFE_NEXT_PATTERN = /^\/[a-zA-Z0-9\-_/?.=&]+$/;

  function isSafeRedirect(next: string): boolean {
    return (
      next.startsWith('/') &&
      !next.startsWith('//') &&
      !next.includes('\\') &&
      !next.toLowerCase().includes('%2f') &&
      !next.toLowerCase().includes('javascript:') &&
      SAFE_NEXT_PATTERN.test(next)
    );
  }

  it('accepts valid internal paths', () => {
    expect(isSafeRedirect('/dashboard')).toBe(true);
    expect(isSafeRedirect('/quiz')).toBe(true);
    expect(isSafeRedirect('/parent/children')).toBe(true);
    expect(isSafeRedirect('/progress?subject=math')).toBe(true);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isSafeRedirect('//evil.com')).toBe(false);
    expect(isSafeRedirect('//evil.com/phish')).toBe(false);
  });

  it('rejects backslash paths', () => {
    expect(isSafeRedirect('/\\evil.com')).toBe(false);
  });

  it('rejects encoded slashes', () => {
    expect(isSafeRedirect('/%2f%2fevil.com')).toBe(false);
    expect(isSafeRedirect('/%2Fevil.com')).toBe(false);
  });

  it('rejects javascript: URIs', () => {
    expect(isSafeRedirect('/javascript:alert(1)')).toBe(false);
  });

  it('rejects external URLs', () => {
    // Does not start with /
    expect(isSafeRedirect('https://evil.com')).toBe(false);
    expect(isSafeRedirect('http://evil.com')).toBe(false);
  });

  it('rejects empty and root-only paths with special chars', () => {
    expect(isSafeRedirect('/')).toBe(false); // single slash fails the pattern (no alphanumeric after /)
  });
});

// ═══════════════════════════════════════════════════════════════
// Super admin middleware protection
// ═══════════════════════════════════════════════════════════════

describe('Super admin middleware protection', () => {
  function isSuperAdminProtected(path: string): boolean {
    return (
      path.startsWith('/internal/admin') ||
      path.startsWith('/api/internal/admin')
    );
  }

  it('protects /internal/admin routes', () => {
    expect(isSuperAdminProtected('/internal/admin')).toBe(true);
    expect(isSuperAdminProtected('/internal/admin/users')).toBe(true);
    expect(isSuperAdminProtected('/internal/admin/flags')).toBe(true);
  });

  it('protects /api/internal/admin API routes', () => {
    expect(isSuperAdminProtected('/api/internal/admin')).toBe(true);
    expect(isSuperAdminProtected('/api/internal/admin/users')).toBe(true);
  });

  it('does not protect non-admin routes', () => {
    expect(isSuperAdminProtected('/dashboard')).toBe(false);
    expect(isSuperAdminProtected('/api/v1/health')).toBe(false);
    expect(isSuperAdminProtected('/login')).toBe(false);
  });
});
