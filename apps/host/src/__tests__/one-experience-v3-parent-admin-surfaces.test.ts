import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), 'src/app');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('One Experience V3 — Parent', () => {
  it('preserves the legacy shell behind the sticky parent V3 flag', () => {
    const source = read('parent/_components/ParentV3LayoutGate.tsx');
    expect(source).toContain("useExperienceV3('parent')");
    expect(source).toContain('<ParentShell>');
    expect(source).toContain('authoritativeChildId={scope?.childId ?? null}');
    expect(source).toContain('manifest={manifest}');
    expect(source).toContain('!routeMapped');
    expect(source).toContain('!routeAllowed');
  });

  it('keeps child scope in every navigation destination and rejects unknown children', () => {
    const source = read('parent/_components/ParentV3Shell.tsx');
    expect(source).toContain("searchParams?.get('childId')");
    expect(source).toContain('const childId = authoritativeChildId');
    expect(source).toContain('childrenList.some((child) => child.studentId === value)');
    expect(source).toContain('encodeURIComponent(childId)');
    expect(source).toContain('/api/v2/parent/children');
  });

  it('implements the approved Home, Progress, Plan and Messages surfaces using production APIs', () => {
    const source = read('parent/_components/ParentV3Views.tsx');
    expect(source).toContain('/api/v2/parent/glance');
    expect(source).toContain('/api/parent/calendar');
    expect(source).toContain('/api/parent/messages/threads');
    expect(source).toContain("method: 'POST'");
    expect(source).not.toContain('value={accuracy ?? 0}');
    expect(source).toContain('temporarily unavailable');
    for (const route of ['home/page.tsx', 'progress/page.tsx', 'plan/page.tsx', 'messages/page.tsx', 'settings/page.tsx']) {
      expect(fs.existsSync(path.join(root, 'parent', route))).toBe(true);
    }
  });
});

describe('One Experience V3 — School Admin', () => {
  it('uses one capability manifest with five mobile destinations and grouped More', () => {
    const source = read('school-admin/_components/SchoolAdminV3Shell.tsx');
    expect(source).toContain('manifest.desktop');
    expect(source).toContain('mobileMoreItems={manifest.more');
    expect(read('school-admin/_components/SchoolAdminV3LayoutGate.tsx')).toContain('manifest={manifest}');
  });

  it('uses the server-authoritative, URL-backed school scope and does not pretend unscoped APIs support academic year', () => {
    const source = read('school-admin/_components/SchoolAdminV3Shell.tsx');
    expect(source).toContain('authoritativeScope?.schoolId');
    expect(source).toContain("searchParams?.get('schoolId')");
    expect(source).toContain("next.set('schoolId', value)");
    expect(source).toContain('schools.length > 1');
    expect(source).not.toContain('.single()');
    expect(source).toContain('All available years');
    expect(source).toContain('disabled');
    expect(source).not.toContain("next.set('academicYear'");
    expect(source).not.toContain('?academicYear=');
    expect(read('school-admin/_components/SchoolAdminV3Views.tsx')).not.toContain('?academicYear=');
  });

  it('provides all canonical school workspaces with governed read models', () => {
    const views = read('school-admin/_components/SchoolAdminV3Views.tsx');
    expect(views).toContain('/api/school-admin/overview');
    expect(views).toContain('/api/school-admin/classes-at-risk');
    expect(views).toContain('/api/school-admin/teacher-engagement');
    expect(views).toContain('/api/school-admin/students');
    expect(views).toContain('/api/school-admin/teachers');
    expect(views).toContain('/api/school-admin/classes');
    expect(views).toContain('/api/school-admin/exams');
    expect(views).not.toContain('value={pct ?? 0}');
    for (const route of ['overview', 'people', 'academics', 'insights', 'governance', 'settings']) {
      expect(fs.existsSync(path.join(root, 'school-admin', route, 'page.tsx'))).toBe(true);
    }
  });
});

describe('One Experience V3 — Super Admin', () => {
  it('server-gates every new operational workspace before rendering it', () => {
    const gate = read('super-admin/_components/SuperAdminV3ServerGate.tsx');
    expect(gate).toContain('requireAdminOrRedirect(requiredLevel)');
    expect(gate).toContain('resolveExperienceV3');
    expect(gate).toContain('resolveRouteCapability');
    expect(gate).toContain('adminExperiencePermissions(admin.adminLevel)');
    for (const route of ['command', 'operations', 'revenue', 'governance', 'settings']) {
      expect(read(`super-admin/${route}/page.tsx`)).toContain('<SuperAdminV3ServerGate legacyHref=');
    }
  });

  it('keeps legacy operator drill-down content inside the persistent V3 shell', () => {
    const source = read('super-admin/_components/AdminShell.tsx');
    expect(source).toContain("useExperienceV3('super-admin')");
    expect(source).toContain('<SuperAdminV3Workspace');
    expect(source).toContain('const showLegacy = v3.legacyAllowed');
    expect(source).toContain('!v3.routeMapped');
    expect(source).toContain('const showV3 = !v3.denied');
    expect(source).toContain('&& v3.routeMapped');
    expect(source).toContain('&& v3.routeAllowed');
    expect(source).toContain('This operator destination is unavailable');
  });

  it('labels platform-wide scope honestly and does not expose a false institution filter', () => {
    const source = read('super-admin/_components/SuperAdminV3Workspace.tsx');
    expect(source).toContain('All institutions · platform-wide');
    expect(source).toContain('label="Data scope"');
    expect(source).toContain('label="Environment"');
    expect(source).toContain('disabled');
    expect(source).not.toContain('requestedInstitution');
    expect(source).not.toContain("searchParams?.get('institutionId')");
    expect(read('super-admin/_components/SuperAdminV3ClientGate.tsx')).toContain('manifest={manifest}');
  });

  it('consolidates the duplicate internal portal and keeps View As explicitly read-only', () => {
    expect(read('internal/admin/page.tsx')).toContain("router.replace('/super-admin/command')");
    expect(read('super-admin/_components/SuperAdminV3Views.tsx')).toContain('Read-only view as');
    expect(read('super-admin/view-as/[studentId]/layout.tsx')).toContain('READ-ONLY VIEW');
  });
});
