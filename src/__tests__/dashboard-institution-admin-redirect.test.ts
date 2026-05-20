import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { getRoleDestination } from '@/lib/identity';

/**
 * Dashboard institution_admin redirect — regression test
 *
 * Bug (2026-05-20): a school_admin (institution_admin) user landing on
 * /dashboard saw the student-dashboard skeleton forever. The page only
 * redirected `teacher` and `guardian` roles to their portals; it had no
 * branch for `institution_admin` and no `student` profile to render.
 *
 * Compounding bug: the login page's `handleSuccess` callback hard-defaulted
 * to the 'student' destination whenever the URL was plain `/login` (no
 * ?role= hint), so school_admins landed on /dashboard before AuthContext
 * had even resolved their role.
 *
 * Compounding bug: AuthContext's role-fallback path (used when
 * get_user_role RPC fails OR when it returns roles: [] because the RPC
 * doesn't know about school_admins) only looked at students/teachers/
 * guardians, never `school_admins`.
 *
 * Fix: three changes in three files. This test pins the contract by
 * verifying:
 *   1. getRoleDestination('institution_admin') === '/school-admin'
 *   2. dashboard/page.tsx contains a redirect branch for institution_admin
 *   3. dashboard/page.tsx renders DashboardSkeleton (not /login bounce)
 *      while institution_admin redirect is in flight
 *   4. login/page.tsx no longer hard-defaults the post-success destination
 *      to 'student' — it must wait for activeRole to populate
 *   5. AuthContext fallback path queries the school_admins table
 *
 * We do source-level structural assertions rather than mount the full
 * dashboard because the dashboard pulls in AuthContext, SWR, AppShell,
 * AtlasDashboard, and ~30 dynamic chunks — a faithful mount is too heavy
 * for a unit test. Regression catalog: post_login_redirect_chain.
 */

describe('post-login redirect chain — institution_admin', () => {
  it('getRoleDestination maps institution_admin to /school-admin', () => {
    expect(getRoleDestination('institution_admin')).toBe('/school-admin');
  });

  it('getRoleDestination maps the four canonical roles correctly', () => {
    // This pins the broader contract so future role additions don't
    // silently break post-login routing.
    expect(getRoleDestination('student')).toBe('/dashboard');
    expect(getRoleDestination('teacher')).toBe('/teacher');
    expect(getRoleDestination('parent')).toBe('/parent');
    expect(getRoleDestination('guardian')).toBe('/parent'); // alias
    expect(getRoleDestination('institution_admin')).toBe('/school-admin');
  });
});

describe('post-login redirect chain — source structure', () => {
  it('dashboard/page.tsx redirects institution_admin to /school-admin', () => {
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/page.tsx'),
      'utf-8'
    );
    // The useEffect must contain a branch that catches institution_admin
    // and routes to /school-admin. We don't pin exact whitespace because
    // the file is heavily formatted — we just check the contract.
    // (Avoid the `s` dotAll regex flag — tsc target is ES2017.)
    expect(file).toMatch(
      /activeRole === 'institution_admin'[\s\S]*?router\.replace\(['"]\/school-admin['"]\)/,
    );
  });

  it('dashboard/page.tsx renders skeleton (not /login bounce) for institution_admin without student profile', () => {
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/page.tsx'),
      'utf-8'
    );
    // The no-student guard must include institution_admin alongside
    // teacher/guardian so that the redirect-in-flight state doesn't
    // bounce the user back to /login.
    expect(file).toMatch(
      /activeRole === 'teacher'[\s\S]*?activeRole === 'guardian'[\s\S]*?activeRole === 'institution_admin'/,
    );
  });

  it('login/page.tsx handleSuccess no longer hard-defaults to the student destination', () => {
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/app/login/page.tsx'),
      'utf-8'
    );
    // The bug-causing call shape was
    //   getRoleDestination(roleParam || 'student')
    // inside handleSuccess. After the fix, the only call to
    // getRoleDestination is inside the role-aware useEffect that consumes
    // activeRole. Pin: handleSuccess must NOT contain "|| 'student'".
    const handleSuccessMatch = file.match(/const handleSuccess[\s\S]*?\}, \[[^\]]*\]\);/);
    expect(handleSuccessMatch).not.toBeNull();
    const handleSuccessBody = handleSuccessMatch![0];
    expect(handleSuccessBody).not.toMatch(/getRoleDestination\(roleParam \|\| ['"]student['"]\)/);
    expect(handleSuccessBody).not.toMatch(/router\.replace\s*\(\s*destination\s*\)/);
  });

  it('login/page.tsx still uses activeRole for routing in the role-aware useEffect', () => {
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/app/login/page.tsx'),
      'utf-8'
    );
    // The redirect must happen via the activeRole-based useEffect so that
    // school_admins go to /school-admin once AuthContext resolves their
    // role.
    expect(file).toMatch(/getRoleDestination\(activeRole\)/);
  });

  it('AuthContext.tsx fallback path queries the school_admins table', () => {
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/lib/AuthContext.tsx'),
      'utf-8'
    );
    // The fallback block (used when get_user_role RPC fails or returns
    // empty roles) must inspect school_admins so that institution_admin
    // users don't end up with activeRole='none'.
    expect(file).toContain("from('school_admins')");
    expect(file).toMatch(/detectedRoles\.push\(['"]institution_admin['"]\)/);
  });
});
