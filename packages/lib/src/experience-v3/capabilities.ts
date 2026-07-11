import { getRoleManifest, ROLE_NAVIGATION } from './manifests';
import type { ExperienceRole, ResolvedCapabilities } from './types';

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
  permissions = [],
}: CapabilityResolutionInput): ResolvedCapabilities {
  const known = ROLE_NAVIGATION[role].desktop.map((item) => item.capability);
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

  const manifest = getRoleManifest(role, capabilities, permissions);
  return { role, capabilities, manifest, canAccess: (capability) => capabilities[capability] === true };
}

export function resolveRouteCapability(manifest: import('./types').RoleManifest, pathname: string): { capability: string; allowed: boolean } | null {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  const candidates = manifest.desktop
    .filter((item) => {
      const itemPath = item.href.split(/[?#]/, 1)[0] || '/';
      return item.exact ? path === itemPath : path === itemPath || path.startsWith(`${itemPath}/`);
    })
    .sort((left, right) => right.href.length - left.href.length);
  const match = candidates[0];
  if (match) return { capability: match.capability, allowed: true };

  // Governed migration aliases keep valid deep links inside the same resolved
  // capability contract. An alias is allowed only when its target capability
  // survived entitlement/permission filtering in this manifest.
  const aliases: Record<import('./types').ExperienceRole, Array<{ paths: string[]; capability: string }>> = {
    student: [
      { paths: ['/dashboard'], capability: 'student.today' },
      { paths: ['/quiz', '/revision', '/review', '/refresh'], capability: 'student.practice' },
      { paths: ['/exam-prep', '/study-plan', '/mock-exam', '/exams', '/pyq'], capability: 'student.exam-plan' },
      { paths: ['/reports'], capability: 'student.progress' },
    ],
    teacher: [
      { paths: ['/teacher'], capability: 'teacher.today' },
      { paths: ['/teacher/assignments'], capability: 'teacher.assign' },
      { paths: ['/teacher/grade-book', '/teacher/submissions'], capability: 'teacher.grade' },
      { paths: ['/teacher/reports'], capability: 'teacher.insights' },
      { paths: ['/teacher/worksheets'], capability: 'teacher.resources' },
      { paths: ['/teacher/profile'], capability: 'shared.settings' },
    ],
    parent: [{ paths: ['/parent'], capability: 'parent.home' }],
    'school-admin': [{ paths: ['/school-admin'], capability: 'school.overview' }],
    'super-admin': [{ paths: ['/super-admin'], capability: 'super.command' }],
  };
  const alias = aliases[manifest.role]
    .slice()
    .sort((left, right) => Math.max(...right.paths.map((item) => item.length)) - Math.max(...left.paths.map((item) => item.length)))
    .find((item) => item.paths.some((aliasPath) => {
      const rootAlias = ['/teacher', '/parent', '/school-admin', '/super-admin'].includes(aliasPath);
      return path === aliasPath || (!rootAlias && path.startsWith(`${aliasPath}/`));
    }));
  if (!alias || !manifest.desktop.some((item) => item.capability === alias.capability)) return null;
  return { capability: alias.capability, allowed: true };
}
