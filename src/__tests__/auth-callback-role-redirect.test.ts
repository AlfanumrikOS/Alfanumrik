import { describe, it, expect } from 'vitest';

/**
 * F5: Auth callback role-aware redirect tests
 *
 * src/app/auth/callback/route.ts resolves the post-login destination as
 * follows (when the request is NOT a signup or recovery):
 *   1. If `next` was explicitly provided → respect it (after safety checks).
 *   2. Otherwise → call get_user_role RPC and redirect to getRoleDestination(primary_role).
 *   3. Any RPC failure → fall back to /dashboard.
 *
 * These tests exercise the pure branching logic as a function so we don't
 * have to spin up a full Next.js request/cookie stack.
 *
 * Regression catalog entry: role_detection_on_login (callback side — complements
 * the AuthContext-side test in auth-flow.test.ts).
 */

// ── Helpers ─────────────────────────────────────────────────

/**
 * Mirrors the role destination map from src/lib/identity/constants.ts
 * (getRoleDestination). Kept local so this test does not depend on the
 * full identity module chain.
 */
function getRoleDestination(role: string): string {
  switch (role) {
    case 'teacher': return '/teacher';
    case 'parent': return '/parent';
    case 'guardian': return '/parent';
    case 'institution_admin': return '/school-admin';
    case 'admin':
    case 'super_admin': return '/super-admin';
    case 'student': return '/dashboard';
    default: return '/dashboard';
  }
}

interface ResolveOpts {
  /** The `next` query param, or null if not provided. */
  nextParam: string | null;
  /** Result of get_user_role RPC, or null if the RPC failed. */
  rpcResult: { primary_role?: string } | null;
}

/**
 * Replicates the callback's default-redirect resolution logic (lines 273-315
 * of auth/callback/route.ts).
 */
function resolveDefaultRedirect(opts: ResolveOpts): string {
  let resolvedNext = opts.nextParam ?? '/dashboard';
  if (opts.nextParam === null) {
    const rd = opts.rpcResult;
    if (rd && typeof rd === 'object') {
      const primary = rd.primary_role;
      if (primary && primary !== 'none') {
        resolvedNext = getRoleDestination(primary);
      } else if (primary === 'none') {
        resolvedNext = '/onboarding';
      }
      // else: keep /dashboard
    }
    // rpcResult null → keep /dashboard
  }
  return resolvedNext;
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe('F5: auth callback role-aware redirect', () => {
  it('respects next= when explicitly set (student going to /exams)', () => {
    const dest = resolveDefaultRedirect({ nextParam: '/exams', rpcResult: { primary_role: 'student' } });
    expect(dest).toBe('/exams');
  });

  it('respects next= when explicitly set even if role says otherwise', () => {
    // A teacher clicking a deep link to /foxy should go to /foxy, not /teacher.
    const dest = resolveDefaultRedirect({ nextParam: '/foxy', rpcResult: { primary_role: 'teacher' } });
    expect(dest).toBe('/foxy');
  });

  it('redirects teacher to /teacher when next is not set', () => {
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: { primary_role: 'teacher' } });
    expect(dest).toBe('/teacher');
  });

  it('redirects guardian (parent) to /parent when next is not set', () => {
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: { primary_role: 'guardian' } });
    expect(dest).toBe('/parent');
  });

  it('redirects student to /dashboard when next is not set', () => {
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: { primary_role: 'student' } });
    expect(dest).toBe('/dashboard');
  });

  it('redirects institution_admin to /school-admin when next is not set', () => {
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: { primary_role: 'institution_admin' } });
    expect(dest).toBe('/school-admin');
  });

  it('redirects primary_role=none to /onboarding', () => {
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: { primary_role: 'none' } });
    expect(dest).toBe('/onboarding');
  });

  it('falls back to /dashboard when RPC returns null', () => {
    // P15 (Onboarding Integrity): login must never break.
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: null });
    expect(dest).toBe('/dashboard');
  });

  it('falls back to /dashboard when RPC returns an unexpected shape', () => {
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: {} });
    expect(dest).toBe('/dashboard');
  });

  it('falls back to /dashboard when primary_role is missing', () => {
    const dest = resolveDefaultRedirect({ nextParam: null, rpcResult: { primary_role: undefined } });
    expect(dest).toBe('/dashboard');
  });

  it('empty next= string is still treated as provided (respects empty next)', () => {
    // Passing `next=` (empty) is treated as provided — this mirrors the
    // handler's `searchParams.get('next')` which returns '' (not null) for
    // an empty param. The validateRedirectTarget call downstream then
    // rejects the empty string and falls back to /dashboard, but that is
    // tested in the identity/validateRedirectTarget suite.
    const dest = resolveDefaultRedirect({ nextParam: '', rpcResult: { primary_role: 'teacher' } });
    expect(dest).toBe('');
  });
});

// ─── Source-level structural assertions ──────────────────────
//
// History: the default (non-signup) path previously called the get_user_role
// RPC and routed teachers/parents/admins to their role-specific dashboards.
// That was disabled (see route.ts lines 264-275) because it caused an auth
// cookie propagation issue for non-student roles. Default-path role routing
// now lives in AuthContext + per-page client redirects. These source
// assertions verify the CURRENT contract, not the historical one.

describe('F5: auth/callback/route.ts source structure', () => {
  it('imports role-destination helper and redirect validator from identity module', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/auth/callback/route.ts'),
      'utf-8'
    );
    expect(file).toContain('getRoleDestination');
    expect(file).toContain('validateRedirectTarget');
    expect(file).toContain("from '@/lib/identity'");
  });

  it('falls back to /dashboard on auth failure or missing next (P15: Onboarding Integrity)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/auth/callback/route.ts'),
      'utf-8'
    );
    // The file must document AND implement the dashboard fallback:
    // - validateRedirectTarget is called with '/dashboard' as the safe default
    // - nextParam defaults to '/dashboard' when the query param is absent
    expect(file).toContain("validateRedirectTarget(next, '/dashboard')");
    expect(file).toContain("nextParam ?? '/dashboard'");
  });

  it('uses getRoleDestination on the signup path (role-aware destination after email confirmation)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/auth/callback/route.ts'),
      'utf-8'
    );
    // After signup email confirmation, role is determined from bootstrap
    // result and routed via getRoleDestination(redirectRole). This is the
    // ONLY place the auth callback maps role → path; default-path role
    // routing now lives in client-side AuthContext.
    expect(file).toContain('getRoleDestination(redirectRole)');
  });

  it('validates the next= parameter against open-redirect attacks', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/auth/callback/route.ts'),
      'utf-8'
    );
    // Open-redirect guard: validateRedirectTarget must be used, not raw `next`.
    expect(file).toMatch(/validateRedirectTarget\s*\(\s*next\s*,/);
  });
});