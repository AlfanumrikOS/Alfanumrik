import { getManifestPermissionContext, getRoleManifest, ROLE_NAVIGATION } from './manifests';
import type { ExperienceRole, ResolvedCapabilities } from './types';

const ACTION_CAPABILITIES: Readonly<Partial<Record<ExperienceRole, ReadonlyArray<{ capability: string; parentCapability: string; requiredPermission: string }>>>> = {
  teacher: [
    { capability: 'teacher.assign.generic', parentCapability: 'teacher.assign', requiredPermission: 'class.manage' },
    { capability: 'teacher.assign.remediation', parentCapability: 'teacher.assign', requiredPermission: 'class.assign_remediation' },
  ],
};

export interface CapabilityResolutionInput {
  role: ExperienceRole;
  applicationDefaults?: Readonly<Record<string, boolean>>;
  environmentConstraints?: Readonly<Record<string, boolean>>;
  databaseOverrides?: Readonly<Record<string, boolean>>;
  tenantEntitlements?: readonly string[];
  permissions?: readonly string[];
}

export function resolveCapabilities({
  role,
  applicationDefaults,
  environmentConstraints = {},
  databaseOverrides = {},
  tenantEntitlements,
  permissions,
}: CapabilityResolutionInput): ResolvedCapabilities {
  const known = Array.from(new Set(ROLE_NAVIGATION[role].desktop.map((item) => item.capability)));
  const defaults = applicationDefaults || Object.fromEntries(known.map((capability) => [capability, true]));
  const entitlementSet = tenantEntitlements ? new Set(tenantEntitlements) : null;
  const capabilities: Record<string, boolean> = {};

  for (const capability of known) {
    const base = defaults[capability] === true;
    const environmentAllowed = environmentConstraints[capability] !== false;
    const databaseAllowed = databaseOverrides[capability] !== false;
    const entitled = entitlementSet ? entitlementSet.has(capability) : true;
    capabilities[capability] = base && environmentAllowed && databaseAllowed && entitled;
  }

  for (const action of ACTION_CAPABILITIES[role] ?? []) {
    // Actions inherit the governed parent route's rollout and entitlement
    // state, then narrow access to the permission enforced by their API.
    capabilities[action.capability] = capabilities[action.parentCapability] === true
      && permissions !== undefined
      && permissions.includes(action.requiredPermission);
  }

  const manifest = getRoleManifest(role, capabilities, permissions);
  return { role, capabilities, manifest, canAccess: (capability) => capabilities[capability] === true };
}

export function resolveRouteCapability(manifest: import('./types').RoleManifest, pathname: string): { capability: string; allowed: boolean } | null {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  // Resolve against the unfiltered canonical manifest first. Otherwise a
  // denied specific route such as /practice/exam could fall through to the
  // broader allowed /practice prefix.
  const canonicalCandidates = ROLE_NAVIGATION[manifest.role].desktop
    .filter((item) => {
      const itemPath = item.href.split(/[?#]/, 1)[0] || '/';
      return item.exact ? path === itemPath : path === itemPath || path.startsWith(`${itemPath}/`);
    })
    .sort((left, right) => right.href.length - left.href.length);
  const canonicalMatch = canonicalCandidates[0];
  if (canonicalMatch) {
    const allowed = manifest.desktop.some((item) => item.href === canonicalMatch.href && item.capability === canonicalMatch.capability);
    return { capability: canonicalMatch.capability, allowed };
  }

  // Governed migration aliases keep valid deep links inside the same resolved
  // capability contract. An alias is allowed only when its target capability
  // survived entitlement/permission filtering in this manifest.
  const aliases: Record<import('./types').ExperienceRole, Array<{ paths: string[]; capability: string; requiredPermissions?: string[] }>> = {
    student: [
      { paths: ['/dashboard'], capability: 'student.today' },
      { paths: ['/quiz', '/revision', '/review', '/refresh'], capability: 'student.practice' },
      { paths: ['/exam-prep', '/study-plan', '/mock-exam', '/exams', '/pyq'], capability: 'student.exam-plan' },
      { paths: ['/reports'], capability: 'student.progress' },
    ],
    teacher: [
      { paths: ['/teacher'], capability: 'teacher.today' },
      { paths: ['/teacher/assignments'], capability: 'teacher.assign', requiredPermissions: ['class.manage'] },
      { paths: ['/teacher/grade-book', '/teacher/submissions'], capability: 'teacher.grade' },
      { paths: ['/teacher/reports'], capability: 'teacher.insights' },
      { paths: ['/teacher/worksheets'], capability: 'teacher.resources' },
      { paths: ['/teacher/profile'], capability: 'shared.settings' },
    ],
    parent: [{ paths: ['/parent'], capability: 'parent.home' }],
    'school-admin': [
      { paths: ['/school-admin'], capability: 'school.overview' },
      {
        paths: ['/school-admin/invite-codes', '/school-admin/enroll', '/school-admin/students'],
        capability: 'school.people',
        requiredPermissions: ['institution.manage_students'],
      },
      { paths: ['/school-admin/teachers'], capability: 'school.people', requiredPermissions: ['institution.manage_teachers'] },
      { paths: ['/school-admin/parents'], capability: 'school.people', requiredPermissions: ['school.manage_settings'] },
      { paths: ['/school-admin/staff'], capability: 'school.people', requiredPermissions: ['institution.manage_staff'] },
      {
        paths: ['/school-admin/classes'],
        capability: 'school.academics',
        requiredPermissions: ['class.manage'],
      },
      { paths: ['/school-admin/exams'], capability: 'school.academics', requiredPermissions: ['school.manage_exams'] },
      { paths: ['/school-admin/content'], capability: 'school.academics', requiredPermissions: ['school.manage_content'] },
      {
        paths: ['/school-admin/branding'],
        capability: 'shared.settings',
        requiredPermissions: ['institution.manage', 'school.manage_branding'],
      },
      { paths: ['/school-admin/modules'], capability: 'shared.settings', requiredPermissions: ['institution.manage', 'school.manage_modules'] },
      { paths: ['/school-admin/api-keys'], capability: 'shared.settings', requiredPermissions: ['institution.manage', 'school.manage_api_keys'] },
      { paths: ['/school-admin/setup'], capability: 'shared.settings', requiredPermissions: ['institution.manage', 'school.manage_settings'] },
      {
        paths: ['/school-admin/rbac'],
        capability: 'school.governance',
        requiredPermissions: ['institution.manage'],
      },
      { paths: ['/school-admin/audit-log'], capability: 'school.governance', requiredPermissions: ['school.manage_settings'] },
    ],
    'super-admin': [
      { paths: ['/super-admin'], capability: 'super.command' },
      {
        paths: [
          '/super-admin/alerts',
          '/super-admin/observability',
          '/super-admin/support',
          '/super-admin/bulk-actions',
          '/super-admin/flags',
          '/super-admin/logs',
          '/super-admin/health',
        ],
        capability: 'super.operations',
      },
      {
        paths: [
          '/super-admin/subscriptions',
          '/super-admin/invoices',
          '/super-admin/analytics-b2b',
          '/super-admin/intelligence/revenue',
        ],
        capability: 'super.revenue',
      },
      {
        paths: [
          '/super-admin/rbac',
          '/super-admin/entitlements',
          '/super-admin/readiness-rubric',
          '/super-admin/users',
        ],
        capability: 'super.governance',
      },
    ],
  };
  const alias = aliases[manifest.role]
    .flatMap((item) => item.paths.map((aliasPath) => ({ ...item, aliasPath })))
    .sort((left, right) => right.aliasPath.length - left.aliasPath.length)
    .find((item) => {
      const rootAlias = ['/teacher', '/parent', '/school-admin', '/super-admin'].includes(item.aliasPath);
      return path === item.aliasPath || (!rootAlias && path.startsWith(`${item.aliasPath}/`));
    });
  if (!alias) return null;
  const capabilityAllowed = manifest.desktop.some((item) => item.capability === alias.capability);
  const permissionContext = getManifestPermissionContext(manifest);
  const permissionAllowed = !alias.requiredPermissions || permissionContext === undefined || alias.requiredPermissions.some((permission) => permissionContext.has(permission));
  return { capability: alias.capability, allowed: capabilityAllowed && permissionAllowed };
}
