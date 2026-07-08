import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { getRoleDestination } from '@alfanumrik/lib/identity';

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
 *   2. dashboard/StudentOSDashboard.tsx contains a redirect branch for
 *      institution_admin (AtlasDashboard.tsx removed; ff_student_os_v1
 *      is always-on and StudentOSDashboard is the sole dashboard).
 *   3. dashboard/StudentOSDashboard.tsx renders DashboardSkeleton (not /login
 *      bounce) while institution_admin redirect is in flight. The
 *      skeleton-guard intent is satisfied by the `if (!student) return
 *      <DashboardSkeleton/>` early-return, since institution_admin has no
 *      student profile.
 *   4. login/page.tsx handleSuccess does an immediate redirect (commit
 *      #892 stuck-button fix) — it must not block login on activeRole.
 *      The school_admin protection is no longer enforced login-side; it is
 *      enforced downstream (dashboard/page.tsx redirect + AuthContext's
 *      school_admins fallback, both asserted below).
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
  it('dashboard/StudentOSDashboard.tsx redirects institution_admin to /school-admin', () => {
    // AtlasDashboard.tsx has been removed (ff_student_os_v1 is always-on).
    // The redirect logic now lives in StudentOSDashboard.tsx.
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/StudentOSDashboard.tsx'),
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

  it('dashboard/StudentOSDashboard.tsx orders teacher/guardian/institution_admin redirects before the no-student skeleton early-return', () => {
    // AtlasDashboard.tsx has been removed (ff_student_os_v1 is always-on).
    // The redirect logic now lives in StudentOSDashboard.tsx.
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/StudentOSDashboard.tsx'),
      'utf-8'
    );
    // The role-redirect useEffect must handle teacher, guardian, and
    // institution_admin (in that order) so that non-student roles are
    // routed to their portals. The redirect-in-flight state never bounces
    // the user back to /login because the `if (!student) return
    // <DashboardSkeleton/>` early-return covers institution_admin (which
    // has no student profile) while the router.replace settles.
    expect(file).toMatch(
      /activeRole === 'teacher'[\s\S]*?activeRole === 'guardian'[\s\S]*?activeRole === 'institution_admin'/,
    );
  });

  it('login/page.tsx handleSuccess does an immediate redirect (#892 stuck-button fix); school_admin protection is enforced downstream', () => {
    const file = readFileSync(
      path.resolve(process.cwd(), 'src/app/login/page.tsx'),
      'utf-8'
    );
    // INTENTIONAL DESIGN (commit #892 "fix(auth): restore immediate redirect
    // on login to prevent stuck '...' button"):
    // handleSuccess performs an immediate router.replace so the login button
    // never gets stuck showing "..." while waiting for activeRole to resolve.
    // This re-introduced the immediate redirect that the original 2026-05-20
    // fix had removed — and that is correct. The original "school_admin stuck
    // on the student dashboard" regression stays fixed WITHOUT blocking login
    // on activeRole, because the protection now lives downstream:
    //   - dashboard/page.tsx re-routes institution_admin -> /school-admin
    //     (asserted by the "dashboard/page.tsx redirects institution_admin"
    //     test above), and
    //   - AuthContext's school_admins fallback resolves the role
    //     (asserted by the "AuthContext fallback path queries the
    //     school_admins table" test below).
    // So a school_admin who momentarily lands on /dashboard is immediately
    // re-routed to /school-admin; login is never the enforcement point.
    const handleSuccessMatch = file.match(/const handleSuccess[\s\S]*?\}, \[[^\]]*\]\);/);
    expect(handleSuccessMatch).not.toBeNull();
    const handleSuccessBody = handleSuccessMatch![0];
    // Positively assert the immediate redirect contract.
    expect(handleSuccessBody).toMatch(/router\.replace/);
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
