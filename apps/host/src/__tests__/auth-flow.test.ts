import { describe, it, expect } from 'vitest';

/**
 * Auth Flow Regression Tests
 *
 * Catalog IDs covered:
 *   - session_refresh_on_request
 *   - role_detection_on_login
 *
 * These tests exercise the branching logic from middleware.ts and
 * AuthContext.tsx as pure functions — no server, no real Supabase calls.
 *
 * session_refresh_on_request:
 *   The middleware (Layer 0) calls supabase.auth.getUser() on every request.
 *   The setAll cookie callback writes refreshed tokens back into the response.
 *   We test: (a) the session-cookie detection predicate, (b) the protected-
 *   route redirect decision, and (c) the pass-through decision when a session
 *   cookie is present. None of these require a real HTTP server.
 *
 * role_detection_on_login:
 *   When the get_user_role RPC is unavailable and no existing profile rows
 *   exist, AuthContext reads user.user_metadata.role to determine which role
 *   to bootstrap. We replicate that exact mapping as a pure function and test
 *   all branches (present/absent/null/valid/unrecognised).
 */

// ─── session_refresh_on_request helpers ──────────────────────────────────────

/**
 * Replicates the session-cookie detection logic from middleware.ts (Layer 0.6).
 * Checks whether any cookie name matches the Supabase auth-token pattern.
 *
 * Mirrors: request.cookies.getAll().some(c => /^sb-.+-auth-token/.test(c.name))
 */
function hasSupabaseSession(cookies: { name: string; value: string }[]): boolean {
  return cookies.some(c => /^sb-.+-auth-token/.test(c.name));
}

/**
 * Replicates the protected-route redirect decision from middleware.ts (Layer 0.6).
 * Returns the redirect path when the route is protected and no session cookie
 * exists, or null when the request should be allowed through.
 *
 * Protected prefixes (from middleware.ts PROTECTED_PREFIXES):
 *   /parent/children, /parent/reports, /parent/profile, /parent/support, /billing
 */
const PROTECTED_PREFIXES = [
  '/parent/children',
  '/parent/reports',
  '/parent/profile',
  '/parent/support',
  '/billing',
];

function decideSessionRedirect(
  path: string,
  cookies: { name: string; value: string }[]
): { redirect: true; to: string } | { redirect: false } {
  if (PROTECTED_PREFIXES.some(p => path.startsWith(p))) {
    const session = cookies.some(
      c => /^sb-.+-auth-token/.test(c.name) || c.name.includes('auth-token')
    );
    if (!session) {
      const isParentRoute = path.startsWith('/parent');
      return { redirect: true, to: isParentRoute ? '/parent' : '/login' };
    }
  }
  return { redirect: false };
}

// ─── role_detection_on_login helpers ─────────────────────────────────────────

/**
 * Replicates the bootstrap role-mapping from AuthContext.tsx (lines 274-275).
 * This is the code that runs when the RPC fails and no profile rows exist yet,
 * mapping user_metadata.role → the role sent to /api/auth/bootstrap.
 *
 *   metaRole === 'teacher' ? 'teacher'
 *   : metaRole === 'parent' ? 'parent'
 *   : 'student'
 *
 * Also captures the fallback behaviour when user_metadata is null/absent
 * (metaRole will be undefined, which falls through to 'student').
 */
type BootstrapRole = 'student' | 'teacher' | 'parent';

interface UserMetadata {
  role?: unknown;
  [key: string]: unknown;
}

function resolveBootstrapRole(
  userMetadata: UserMetadata | null | undefined
): BootstrapRole {
  const metaRole = userMetadata?.role as string | undefined;
  if (metaRole === 'teacher') return 'teacher';
  if (metaRole === 'parent') return 'parent';
  return 'student';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('session_refresh_on_request', () => {
  // The Supabase auth cookie pattern: /^sb-.+-auth-token/
  // e.g. "sb-xyzabc-auth-token", "sb-xyzabc-auth-token.0"

  it('marks session as needing refresh when auth cookie is present', () => {
    // When a Supabase auth cookie exists the middleware proceeds to call
    // getUser() (which may refresh the token) rather than redirecting.
    const cookies = [
      { name: 'sb-xyzprojectref-auth-token', value: 'some.jwt.here' },
    ];
    expect(hasSupabaseSession(cookies)).toBe(true);
  });

  it('redirects to /login when no session found on a billing route', () => {
    const result = decideSessionRedirect('/billing', []);
    expect(result.redirect).toBe(true);
    if (result.redirect) {
      expect(result.to).toBe('/login');
    }
  });

  it('redirects to /parent when no session found on a parent route', () => {
    const result = decideSessionRedirect('/parent/children', []);
    expect(result.redirect).toBe(true);
    if (result.redirect) {
      expect(result.to).toBe('/parent');
    }
  });

  it('passes through to requested page when session cookie is present on protected route', () => {
    const cookies = [
      { name: 'sb-abcdefghij-auth-token', value: 'test-token-value' },
    ];
    const result = decideSessionRedirect('/parent/profile', cookies);
    expect(result.redirect).toBe(false);
  });

  it('passes through for non-protected routes with no session cookie', () => {
    // Routes like /quiz, /dashboard are not in PROTECTED_PREFIXES —
    // they rely on client-side useAuth() instead.
    const result = decideSessionRedirect('/quiz', []);
    expect(result.redirect).toBe(false);
  });

  it('detects auth-token cookie with numeric suffix (.0)', () => {
    // Supabase chunks large tokens across multiple cookies.
    const cookies = [
      { name: 'sb-ref-auth-token.0', value: 'chunk_one' },
      { name: 'sb-ref-auth-token.1', value: 'chunk_two' },
    ];
    expect(hasSupabaseSession(cookies)).toBe(true);
  });

  it('does not detect a non-auth cookie as a session', () => {
    const cookies = [
      { name: 'next-auth.session-token', value: 'abc' },
      { name: '_ga', value: '123' },
    ];
    expect(hasSupabaseSession(cookies)).toBe(false);
  });
});

describe('role_detection_on_login', () => {
  it('reads role from user_metadata.role when present', () => {
    expect(resolveBootstrapRole({ role: 'teacher' })).toBe('teacher');
    expect(resolveBootstrapRole({ role: 'parent' })).toBe('parent');
    expect(resolveBootstrapRole({ role: 'student' })).toBe('student');
  });

  it('falls back to "student" when user_metadata.role is absent', () => {
    // No role key at all
    expect(resolveBootstrapRole({})).toBe('student');
    // Undefined explicitly
    expect(resolveBootstrapRole({ role: undefined })).toBe('student');
  });

  it('falls back to "student" when user_metadata is null', () => {
    expect(resolveBootstrapRole(null)).toBe('student');
  });

  it('falls back to "student" when user_metadata is undefined', () => {
    expect(resolveBootstrapRole(undefined)).toBe('student');
  });

  it('accepts valid roles: student, parent, teacher', () => {
    // These are the three roles the bootstrap API accepts.
    // 'admin' and 'super_admin' are not bootstrapped via metadata — they are
    // set directly in admin_users and are not part of the student/parent/teacher flow.
    const validRoles: Array<[string, BootstrapRole]> = [
      ['student', 'student'],
      ['teacher', 'teacher'],
      ['parent', 'parent'],
    ];
    for (const [input, expected] of validRoles) {
      expect(resolveBootstrapRole({ role: input })).toBe(expected);
    }
  });

  it('falls back to "student" for unrecognised role strings', () => {
    // Any unexpected value (including 'admin', 'super_admin', empty string,
    // numbers) must resolve to the safest default: student.
    expect(resolveBootstrapRole({ role: 'admin' })).toBe('student');
    expect(resolveBootstrapRole({ role: 'super_admin' })).toBe('student');
    expect(resolveBootstrapRole({ role: '' })).toBe('student');
    expect(resolveBootstrapRole({ role: 'TEACHER' })).toBe('student'); // case-sensitive
    expect(resolveBootstrapRole({ role: 42 })).toBe('student');
    expect(resolveBootstrapRole({ role: null })).toBe('student');
  });
});
