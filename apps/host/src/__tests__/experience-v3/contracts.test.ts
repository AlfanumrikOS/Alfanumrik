import { describe, expect, it } from 'vitest';
import {
  EXPERIENCE_V3_FLAGS,
  experienceV3ScopeQuery,
  getRoleManifest,
  resolveCapabilities,
  resolveRouteCapability,
  resolveTenantBranding,
  scopeCacheKey,
  withScope,
  type ExperienceRole,
} from '@alfanumrik/lib/experience-v3';
import { FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';
import { adminExperiencePermissions } from '@alfanumrik/lib/admin-auth';

const roles: ExperienceRole[] = ['student', 'teacher', 'parent', 'school-admin', 'super-admin'];

describe('One Experience V3 contracts', () => {
  it('keeps every role flag fail-closed by default', () => {
    for (const flag of Object.values(EXPERIENCE_V3_FLAGS)) expect(FLAG_DEFAULTS[flag]).toBe(false);
  });

  it.each(roles)('%s has one canonical, unique and capability-backed manifest', (role) => {
    const manifest = getRoleManifest(role);
    expect(manifest.desktop.length).toBeGreaterThanOrEqual(7);
    expect(new Set(manifest.desktop.map((item) => item.href)).size).toBe(manifest.desktop.length);
    expect(manifest.desktop.every((item) => Boolean(item.capability))).toBe(true);
    expect(manifest.primary).toHaveLength(4);
  });

  it('filters navigation and access through the same capability result', () => {
    const result = resolveCapabilities({ role: 'teacher', databaseOverrides: { 'teacher.grade': false } });
    expect(result.canAccess('teacher.grade')).toBe(false);
    expect(result.manifest.desktop.some((item) => item.capability === 'teacher.grade')).toBe(false);
  });

  it('resolves Teacher Assign navigation and actions from the permissions enforced by each POST route', () => {
    const generic = resolveCapabilities({ role: 'teacher', permissions: ['class.manage'] });
    expect(generic.manifest.desktop.some((item) => item.capability === 'teacher.assign')).toBe(true);
    expect(generic.canAccess('teacher.assign.generic')).toBe(true);
    expect(generic.canAccess('teacher.assign.remediation')).toBe(false);
    expect(resolveRouteCapability(generic.manifest, '/teacher/assign')).toEqual({ capability: 'teacher.assign', allowed: true });
    expect(resolveRouteCapability(generic.manifest, '/teacher/assignments')).toEqual({ capability: 'teacher.assign', allowed: true });

    const remediation = resolveCapabilities({ role: 'teacher', permissions: ['class.assign_remediation'] });
    expect(remediation.manifest.desktop.some((item) => item.capability === 'teacher.assign')).toBe(true);
    expect(remediation.canAccess('teacher.assign.generic')).toBe(false);
    expect(remediation.canAccess('teacher.assign.remediation')).toBe(true);
    expect(resolveRouteCapability(remediation.manifest, '/teacher/assign')).toEqual({ capability: 'teacher.assign', allowed: true });
    expect(resolveRouteCapability(remediation.manifest, '/teacher/assignments')).toEqual({ capability: 'teacher.assign', allowed: false });

    const examOnly = resolveCapabilities({ role: 'teacher', permissions: ['exam.assign'] });
    expect(examOnly.manifest.desktop.some((item) => item.capability === 'teacher.assign')).toBe(false);
    expect(examOnly.canAccess('teacher.assign.generic')).toBe(false);
    expect(examOnly.canAccess('teacher.assign.remediation')).toBe(false);
    expect(resolveRouteCapability(examOnly.manifest, '/teacher/assign')).toEqual({ capability: 'teacher.assign', allowed: false });

    expect(getRoleManifest('teacher').desktop.some((item) => item.capability === 'teacher.assign')).toBe(true);
  });

  it('makes every visible protected route accessible and every unavailable capability absent', () => {
    const denied = resolveCapabilities({ role: 'super-admin', permissions: [] });
    expect(denied.manifest.desktop.some((item) => item.href === '/super-admin/governance')).toBe(false);
    expect(resolveRouteCapability(denied.manifest, '/super-admin/governance')).toEqual({ capability: 'super.governance', allowed: false });

    const allowed = resolveCapabilities({ role: 'super-admin', permissions: ['role.manage', 'system.audit', 'system.config', 'finance.view_revenue'] });
    for (const item of allowed.manifest.desktop) {
      expect(allowed.canAccess(item.capability)).toBe(true);
      expect(resolveRouteCapability(allowed.manifest, item.href)).toEqual({ capability: item.capability, allowed: true });
    }
  });

  it('keeps governed migration aliases inside their target capability', () => {
    const student = resolveCapabilities({ role: 'student', databaseOverrides: { 'student.exam-plan': false } });
    expect(resolveRouteCapability(student.manifest, '/quiz/session-1')?.capability).toBe('student.practice');
    expect(resolveRouteCapability(student.manifest, '/reports')).toEqual({ capability: 'student.progress', allowed: true });
    expect(resolveRouteCapability(student.manifest, '/exam-prep')).toEqual({ capability: 'student.exam-plan', allowed: false });
    expect(resolveRouteCapability(student.manifest, '/practice/exam/mock')).toEqual({ capability: 'student.exam-plan', allowed: false });
    const parent = resolveCapabilities({ role: 'parent' });
    expect(resolveRouteCapability(parent.manifest, '/parent')?.capability).toBe('parent.home');
  });

  it('does not claim or advertise legacy and nonexistent destinations', () => {
    expect(resolveRouteCapability(getRoleManifest('student'), '/student-library')).toBeNull();
    expect(resolveRouteCapability(getRoleManifest('parent'), '/parent/attendance')).toBeNull();
    const studentHrefs = getRoleManifest('student').desktop.map((item) => item.href);
    const parentHrefs = getRoleManifest('parent').desktop.map((item) => item.href);
    expect(studentHrefs).not.toEqual(expect.arrayContaining(['/notebook', '/downloads', '/role-switch']));
    expect(parentHrefs).not.toContain('/role-switch');
  });

  it('keeps School Admin deep links inside their canonical capability and shell', () => {
    const allowed = resolveCapabilities({
      role: 'school-admin',
      permissions: ['institution.manage', 'institution.manage_students', 'institution.manage_teachers', 'institution.manage_staff', 'school.manage_settings', 'class.manage', 'school.manage_exams', 'school.manage_content'],
    });
    expect(resolveRouteCapability(allowed.manifest, '/school-admin/students/learner-1')).toEqual({ capability: 'school.people', allowed: true });
    expect(resolveRouteCapability(allowed.manifest, '/school-admin/classes/class-1')).toEqual({ capability: 'school.academics', allowed: true });
    expect(resolveRouteCapability(allowed.manifest, '/school-admin/branding')).toEqual({ capability: 'shared.settings', allowed: true });
    expect(resolveRouteCapability(allowed.manifest, '/school-admin/audit-log')).toEqual({ capability: 'school.governance', allowed: true });

    const denied = resolveCapabilities({
      role: 'school-admin',
      databaseOverrides: { 'school.people': false, 'school.academics': false },
      permissions: [],
    });
    expect(resolveRouteCapability(denied.manifest, '/school-admin/students')).toEqual({ capability: 'school.people', allowed: false });
    expect(resolveRouteCapability(denied.manifest, '/school-admin/classes')).toEqual({ capability: 'school.academics', allowed: false });
    expect(resolveRouteCapability(denied.manifest, '/school-admin/branding')).toEqual({ capability: 'shared.settings', allowed: false });
    expect(resolveRouteCapability(denied.manifest, '/school-admin/audit-log')).toEqual({ capability: 'school.governance', allowed: false });
  });

  it('keeps School Admin group navigation visible without granting sibling actions', () => {
    const studentsOnly = resolveCapabilities({ role: 'school-admin', permissions: ['institution.manage_students'] });
    expect(studentsOnly.manifest.desktop.some((item) => item.capability === 'school.people')).toBe(true);
    expect(resolveRouteCapability(studentsOnly.manifest, '/school-admin/students/learner-1')).toEqual({ capability: 'school.people', allowed: true });
    expect(resolveRouteCapability(studentsOnly.manifest, '/school-admin/teachers')).toEqual({ capability: 'school.people', allowed: false });
    expect(resolveRouteCapability(studentsOnly.manifest, '/school-admin/staff')).toEqual({ capability: 'school.people', allowed: false });

    const classOnly = resolveCapabilities({ role: 'school-admin', permissions: ['class.manage'] });
    expect(classOnly.manifest.desktop.some((item) => item.capability === 'school.academics')).toBe(true);
    expect(resolveRouteCapability(classOnly.manifest, '/school-admin/classes/class-1')).toEqual({ capability: 'school.academics', allowed: true });
    expect(resolveRouteCapability(classOnly.manifest, '/school-admin/exams')).toEqual({ capability: 'school.academics', allowed: false });
    expect(resolveRouteCapability(classOnly.manifest, '/school-admin/content')).toEqual({ capability: 'school.academics', allowed: false });
  });

  it.each([
    ['/school-admin/teachers/teacher-1', 'school.people', 'institution.manage_teachers'],
    ['/school-admin/staff', 'school.people', 'institution.manage_staff'],
    ['/school-admin/parents', 'school.people', 'school.manage_settings'],
    ['/school-admin/exams/exam-1', 'school.academics', 'school.manage_exams'],
    ['/school-admin/content', 'school.academics', 'school.manage_content'],
    ['/school-admin/branding', 'shared.settings', 'school.manage_branding'],
    ['/school-admin/modules', 'shared.settings', 'school.manage_modules'],
    ['/school-admin/api-keys', 'shared.settings', 'school.manage_api_keys'],
    ['/school-admin/rbac', 'school.governance', 'institution.manage'],
    ['/school-admin/audit-log', 'school.governance', 'school.manage_settings'],
  ])('enforces the API permission for School deep link %s', (path, capability, permission) => {
    const allowed = resolveCapabilities({ role: 'school-admin', permissions: [permission] });
    expect(resolveRouteCapability(allowed.manifest, path)).toEqual({ capability, allowed: true });

    const denied = resolveCapabilities({ role: 'school-admin', permissions: [] });
    expect(resolveRouteCapability(denied.manifest, path)).toEqual({ capability, allowed: false });
  });

  it('keeps Super Admin drill-downs inside their canonical capability and shell', () => {
    const allowed = resolveCapabilities({ role: 'super-admin', permissions: ['role.manage', 'system.audit', 'system.config', 'finance.view_revenue'] });
    expect(resolveRouteCapability(allowed.manifest, '/super-admin/alerts/alert-1')).toEqual({ capability: 'super.operations', allowed: true });
    expect(resolveRouteCapability(allowed.manifest, '/super-admin/invoices')).toEqual({ capability: 'super.revenue', allowed: true });
    expect(resolveRouteCapability(allowed.manifest, '/super-admin/rbac')).toEqual({ capability: 'super.governance', allowed: true });

    const denied = resolveCapabilities({
      role: 'super-admin',
      databaseOverrides: { 'super.operations': false, 'super.revenue': false },
      permissions: [],
    });
    expect(resolveRouteCapability(denied.manifest, '/super-admin/alerts')).toEqual({ capability: 'super.operations', allowed: false });
    expect(resolveRouteCapability(denied.manifest, '/super-admin/invoices')).toEqual({ capability: 'super.revenue', allowed: false });
    expect(resolveRouteCapability(denied.manifest, '/super-admin/rbac')).toEqual({ capability: 'super.governance', allowed: false });
  });

  it('projects exact operator navigation permissions from the verified admin level', () => {
    expect(adminExperiencePermissions('support')).toEqual(['system.audit']);
    expect(adminExperiencePermissions('finance')).toEqual(['system.audit', 'finance.view_revenue']);
    expect(adminExperiencePermissions('admin')).toEqual(['system.audit', 'finance.view_revenue', 'role.manage']);
    expect(adminExperiencePermissions('super_admin')).toEqual(['system.audit', 'finance.view_revenue', 'role.manage', 'system.config']);
    expect(adminExperiencePermissions('unknown')).toEqual([]);
  });

  it('preserves role scope in URLs and cache keys', () => {
    const scope = { kind: 'parent' as const, childId: 'child-2' };
    expect(withScope('/parent/progress?view=mastery', scope)).toBe('/parent/progress?view=mastery&childId=child-2');
    expect(scopeCacheKey('parent', scope)).toEqual(['experience-v3', 'parent', 'childId=child-2']);
    expect(experienceV3ScopeQuery('parent', 'tab=week&childId=child-2')).toBe('childId=child-2');
    expect(experienceV3ScopeQuery('teacher', 'view=heatmap&class=class-b')).toBe('classId=class-b');
    expect(experienceV3ScopeQuery('teacher', 'class=legacy&classId=canonical')).toBe('classId=canonical');
    expect(experienceV3ScopeQuery('school-admin', 'schoolId=school-b&childId=ignored')).toBe('schoolId=school-b');
  });

  it('fails protected navigation closed when runtime permissions are absent', () => {
    const school = resolveCapabilities({ role: 'school-admin', permissions: [] });
    expect(school.manifest.desktop).toHaveLength(0);
    expect(resolveRouteCapability(school.manifest, '/school-admin/overview')).toEqual({ capability: 'school.overview', allowed: false });

    const parent = resolveCapabilities({ role: 'parent', permissions: [] });
    expect(parent.manifest.desktop.some((item) => item.href === '/parent/progress')).toBe(false);
    expect(resolveRouteCapability(parent.manifest, '/parent/progress')).toEqual({ capability: 'parent.progress', allowed: false });
  });

  it('only accepts controlled six-digit hex tenant accents', () => {
    expect(resolveTenantBranding({ schoolName: '  Vidya School  ', accent: '#176D68', enabledModules: ['learn', 'learn'] })).toMatchObject({ schoolName: 'Vidya School', accent: '#176D68', enabledModules: ['learn'] });
    expect(resolveTenantBranding({ accent: 'red; color:black' }).accent).toBeUndefined();
  });

  it('pins the rollout endpoint to authoritative role membership checks', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile('src/app/api/experience-v3/route.ts', 'utf8');
    expect(source).toContain('getRoleMembership');
    expect(source).toContain("from('students')");
    expect(source).toContain("from('teachers')");
    expect(source).toContain("from('guardians')");
    expect(source).toContain("from('school_admins')");
    expect(source).toContain("from('admin_users')");
    expect(source).toContain("select('id,admin_level')");
    expect(source).toContain('adminExperiencePermissions(membership.adminLevel)');
    expect(source).toContain(".in('status', ['active', 'approved'])");
    expect(source).toContain("linksQuery.eq('student_id', requestedScope.childId)");
    expect(source).toContain("rows.find((item) => item.school_id === requestedScope.schoolId)");
    expect(source).toContain("schools!inner(id,name,is_active)");
    expect(source).not.toContain("from('school_admins').select('id,school_id').eq('auth_user_id', userId).eq('is_active', true).limit(1).maybeSingle()");
    expect(source).toContain('status: 403');

    const client = await fs.readFile('../../packages/lib/src/use-experience-v3.ts', 'utf8');
    expect(client).toContain('experienceV3ScopeQuery(role');
    expect(client).toContain("response.status === 403");
    expect(client).toContain("response.status === 401");
    expect(client).toContain('if (response.status === 401) return DENIED');
    expect(client).toContain('routeMapped: value.routeMapped === true');
    expect(client).toContain('const FLAG_OFF');
    expect(client).toContain('legacyAllowed: true');
    expect(client).toContain('const DENIED');
  });

  it('allows legacy auth handling for flag-off and unauthenticated states while keeping permission denial closed', async () => {
    const fs = await import('node:fs/promises');
    const gates = [
      'src/app/(student)/_components/StudentV3Gate.tsx',
      'src/app/(student)/layout.tsx',
      'src/app/teacher/_components/TeacherV3LayoutGate.tsx',
      'src/app/teacher/_components/TeacherV3Pages.tsx',
      'src/app/parent/_components/ParentV3LayoutGate.tsx',
      'src/app/school-admin/_components/SchoolAdminV3LayoutGate.tsx',
      'src/app/super-admin/_components/SuperAdminV3ClientGate.tsx',
    ];
    for (const file of gates) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, file).toContain('legacyAllowed');
      expect(source, file).toContain('routeMapped');
      expect(source, file).toContain('state="permission"');
    }
  });

  it('bridges super-admin login into the verified SSR session gate', async () => {
    const fs = await import('node:fs/promises');
    const login = await fs.readFile('src/app/api/super-admin/login/route.ts', 'utf8');
    const serverGate = await fs.readFile('../../packages/lib/src/admin-auth-server.ts', 'utf8');
    expect(login).toContain('createServerClient');
    expect(login).toContain('ssr.auth.setSession');
    expect(serverGate).toContain('createSupabaseServerClient');
    expect(serverGate).toContain('supabase.auth.getUser()');
    expect(serverGate).not.toContain('parseSupabaseAuthCookieValue');
  });

  it('revokes and expires the server admin session on logout', async () => {
    const fs = await import('node:fs/promises');
    const logout = await fs.readFile('src/app/api/super-admin/logout/route.ts', 'utf8');
    const legacyShell = await fs.readFile('src/app/super-admin/_components/AdminShell.tsx', 'utf8');
    const v3Shell = await fs.readFile('src/app/super-admin/_components/SuperAdminV3Workspace.tsx', 'utf8');
    expect(logout).toContain("signOut({ scope: 'local' })");
    expect(logout).toContain('maxAge: 0');
    expect(logout).toContain('new Date(0)');
    expect(legacyShell).toContain('/api/super-admin/logout');
    expect(v3Shell).toContain('/api/super-admin/logout');
  });

  it('keeps root and V3 main-content ownership unambiguous', async () => {
    const fs = await import('node:fs/promises');
    const root = await fs.readFile('src/app/layout.tsx', 'utf8');
    const globalLayout = await fs.readFile('../../packages/ui/src/navigation/GlobalAppLayout.tsx', 'utf8');
    const roleShell = await fs.readFile('../../packages/ui/src/v3/shells/RoleShell.tsx', 'utf8');
    const leaderboard = await fs.readFile('src/app/(student)/leaderboard/page.tsx', 'utf8');
    const rewards = await fs.readFile('src/app/(student)/rewards/page.tsx', 'utf8');
    expect(root).toContain('<a href="#main-content"');
    expect(globalLayout).toContain('<div id="main-content" tabIndex={-1} data-global-main-content>');
    expect(globalLayout).not.toContain('experienceV3Active ? children');
    expect(roleShell).toContain('<main tabIndex={-1}');
    expect(roleShell).not.toContain('<main id="main-content"');
    expect(leaderboard).toContain('useIsInsideRoleShellMain()');
    expect(leaderboard).toContain("const ContentElement = isInsideRoleShellMain ? 'div' : 'main';");
    // /rewards was consolidated into /leaderboard. It is no longer a dead
    // re-export of the leaderboard page component (which rendered leaderboard
    // content at the /rewards URL and duplicated the main-content ownership
    // problem this test guards). It now issues a real server-side redirect to
    // the canonical /leaderboard URL. Pin that intent — not a no-op.
    expect(rewards).toContain("import { redirect } from 'next/navigation'");
    expect(rewards).toContain("redirect('/leaderboard')");
    expect(rewards).not.toContain("export { default } from '../leaderboard/page';");
  });

  it('keeps the code-backed dev/preview surfaces 404 in production (page guard + middleware gate)', async () => {
    const fs = await import('node:fs/promises');

    // Defense-in-depth layer 1: every dev-only preview page carries a
    // page-level production guard that calls notFound(). NODE_ENV is statically
    // inlined in the client bundle, so this fires on SSR and client navigation.
    const devPages = [
      'src/app/dev/experience-v3/page.tsx',
      'src/app/dev/ui/page.tsx',
      'src/app/dev/cosmic-preview/page.tsx',
    ];
    for (const file of devPages) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, file).toContain("import { notFound } from 'next/navigation'");
      expect(source, file).toContain(
        "if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') notFound();",
      );
    }

    // Defense-in-depth layer 2: the middleware (proxy.ts) enforces a real
    // HTTP-boundary 404 for the SAME three dev surfaces (exact + subpath) in
    // production, before any page shell can stream a 200.
    const proxy = await fs.readFile('src/proxy.ts', 'utf8');
    for (const devPath of ['/dev/experience-v3', '/dev/ui', '/dev/cosmic-preview']) {
      expect(proxy, devPath).toContain(`pathname === '${devPath}'`);
      expect(proxy, devPath).toContain(`pathname.startsWith('${devPath}/')`);
    }
    expect(proxy).toContain('new NextResponse(null, { status: 404 })');
  });
});
