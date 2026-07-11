import { describe, expect, it } from 'vitest';
import {
  EXPERIENCE_V3_FLAGS,
  getRoleManifest,
  resolveCapabilities,
  resolveRouteCapability,
  resolveTenantBranding,
  scopeCacheKey,
  withScope,
  type ExperienceRole,
} from '@alfanumrik/lib/experience-v3';
import { FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';

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

  it('makes every visible protected route accessible and every unavailable capability absent', () => {
    const denied = resolveCapabilities({ role: 'super-admin', permissions: [] });
    expect(denied.manifest.desktop.some((item) => item.href === '/super-admin/governance')).toBe(false);
    expect(resolveRouteCapability(denied.manifest, '/super-admin/governance')).toBeNull();

    const allowed = resolveCapabilities({ role: 'super-admin', permissions: ['role.manage', 'system.audit', 'system.config'] });
    for (const item of allowed.manifest.desktop) {
      expect(allowed.canAccess(item.capability)).toBe(true);
      expect(resolveRouteCapability(allowed.manifest, item.href)).toEqual({ capability: item.capability, allowed: true });
    }
  });

  it('keeps governed migration aliases inside their target capability', () => {
    const student = resolveCapabilities({ role: 'student', databaseOverrides: { 'student.exam-plan': false } });
    expect(resolveRouteCapability(student.manifest, '/quiz/session-1')?.capability).toBe('student.practice');
    expect(resolveRouteCapability(student.manifest, '/reports')).toEqual({ capability: 'student.progress', allowed: true });
    expect(resolveRouteCapability(student.manifest, '/exam-prep')).toBeNull();
    const parent = resolveCapabilities({ role: 'parent' });
    expect(resolveRouteCapability(parent.manifest, '/parent')?.capability).toBe('parent.home');
  });

  it('preserves role scope in URLs and cache keys', () => {
    const scope = { kind: 'parent' as const, childId: 'child-2' };
    expect(withScope('/parent/progress?view=mastery', scope)).toBe('/parent/progress?view=mastery&childId=child-2');
    expect(scopeCacheKey('parent', scope)).toEqual(['experience-v3', 'parent', 'childId=child-2']);
  });

  it('only accepts controlled six-digit hex tenant accents', () => {
    expect(resolveTenantBranding({ schoolName: '  Vidya School  ', accent: '#176D68', enabledModules: ['learn', 'learn'] })).toMatchObject({ schoolName: 'Vidya School', accent: '#176D68', enabledModules: ['learn'] });
    expect(resolveTenantBranding({ accent: 'red; color:black' }).accent).toBeUndefined();
  });

  it('pins the rollout endpoint to authoritative role membership checks', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile('src/app/api/experience-v3/route.ts', 'utf8'));
    expect(source).toContain('getRoleMembership');
    expect(source).toContain("from('students')");
    expect(source).toContain("from('teachers')");
    expect(source).toContain("from('guardians')");
    expect(source).toContain("from('school_admins')");
    expect(source).toContain("from('admin_users')");
    expect(source).toContain('status: 403');
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
    const roleShell = await fs.readFile('../../packages/ui/src/v3/shells/RoleShell.tsx', 'utf8');
    expect(root).not.toContain('<div id="main-content"');
    expect(roleShell).toContain('<main id="main-content" tabIndex={-1}');
  });
});
