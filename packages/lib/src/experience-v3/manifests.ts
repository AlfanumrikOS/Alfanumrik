import type { ExperienceRole, NavigationEntry, RoleManifest } from './types';

const entry = (label: string, href: string, capability: string, options: Partial<NavigationEntry> = {}): NavigationEntry => ({ label, href, capability, ...options });

export const ROLE_NAVIGATION: Readonly<Record<ExperienceRole, RoleManifest>> = {
  student: {
    role: 'student',
    homeHref: '/today',
    primary: [
      entry('Today', '/today', 'student.today', { exact: true, requiredPermission: 'study_plan.view' }),
      entry('Learn', '/learn', 'student.learn', { requiredPermission: 'study_plan.view' }),
      entry('Practice', '/practice', 'student.practice', { requiredPermission: 'quiz.attempt' }),
      entry('Progress', '/progress', 'student.progress', { requiredPermission: 'progress.view_own' }),
    ],
    more: [
      entry('Foxy history', '/foxy', 'student.foxy', { requiredPermission: 'foxy.chat' }),
      entry('Rewards', '/rewards', 'student.rewards', { requiredPermission: 'leaderboard.view' }),
      entry('Notebook', '/notebook', 'student.notebook', { requiredPermission: 'image.view_own' }),
      entry('Exam plan', '/practice/exam', 'student.exam-plan', { requiredPermission: 'exam.view' }),
      entry('Downloads', '/downloads', 'student.downloads', { requiredPermission: 'report.download_own' }),
      entry('Settings', '/settings', 'shared.settings', { requiredPermission: 'profile.update_own' }),
      entry('Help', '/help', 'shared.help'),
      entry('Switch role', '/role-switch', 'shared.role-switch'),
    ],
    desktop: [],
  },
  teacher: {
    role: 'teacher',
    homeHref: '/teacher/today',
    primary: [
      entry('Today', '/teacher/today', 'teacher.today', { exact: true, requiredPermission: 'class.view_analytics' }),
      entry('Students', '/teacher/students', 'teacher.students', { requiredPermission: 'class.manage' }),
      entry('Assign', '/teacher/assign', 'teacher.assign', { requiredPermissions: ['class.manage', 'class.assign_remediation'] }),
      entry('Inbox', '/teacher/messages', 'teacher.messages', { requiredPermission: 'class.manage' }),
    ],
    more: [
      entry('Classes', '/teacher/classes', 'teacher.classes', { requiredPermission: 'class.manage' }),
      entry('Grade', '/teacher/grade', 'teacher.grade', { requiredPermission: 'student.provide_feedback' }),
      entry('Insights', '/teacher/insights', 'teacher.insights', { requiredPermission: 'class.view_analytics' }),
      entry('Resources', '/teacher/resources', 'teacher.resources', { requiredPermission: 'worksheet.create' }),
      entry('Settings', '/teacher/settings', 'shared.settings', { requiredPermission: 'profile.update_own' }),
    ],
    desktop: [],
  },
  parent: {
    role: 'parent',
    homeHref: '/parent/home',
    primary: [
      entry('Home', '/parent/home', 'parent.home', { exact: true, requiredPermission: 'child.view_progress' }),
      entry('Progress', '/parent/progress', 'parent.progress', { requiredPermission: 'child.view_progress' }),
      entry('Plan', '/parent/plan', 'parent.plan', { requiredPermission: 'child.view_exams' }),
      entry('Messages', '/parent/messages', 'parent.messages', { requiredPermission: 'child.view_progress' }),
    ],
    more: [
      entry('Calendar', '/parent/calendar', 'parent.calendar', { requiredPermission: 'child.view_exams' }),
      entry('Reports', '/parent/reports', 'parent.reports', { requiredPermission: 'child.download_report' }),
      entry('Settings', '/parent/settings', 'shared.settings', { requiredPermission: 'profile.update_own' }),
      entry('Help', '/help', 'shared.help'),
      entry('Switch role', '/role-switch', 'shared.role-switch'),
    ],
    desktop: [],
  },
  'school-admin': {
    role: 'school-admin',
    homeHref: '/school-admin/overview',
    primary: [
      entry('Overview', '/school-admin/overview', 'school.overview', { exact: true, requiredPermission: 'institution.view_analytics' }),
      entry('People', '/school-admin/people', 'school.people', { requiredPermissions: ['institution.manage_students', 'institution.manage_teachers', 'institution.manage_staff', 'school.manage_settings'] }),
      entry('Academics', '/school-admin/academics', 'school.academics', { requiredPermissions: ['class.manage', 'school.manage_exams', 'school.manage_content'] }),
      entry('Insights', '/school-admin/insights', 'school.insights', { requiredPermission: 'institution.view_analytics' }),
    ],
    more: [
      entry('Announcements', '/school-admin/announcements', 'school.announcements', { requiredPermission: 'institution.manage' }),
      entry('Reports', '/school-admin/reports', 'school.reports', { requiredPermission: 'report.view_class' }),
      entry('Governance', '/school-admin/governance', 'school.governance', { requiredPermissions: ['institution.manage', 'school.manage_settings'] }),
      entry('Settings', '/school-admin/settings', 'shared.settings', { requiredPermissions: ['institution.manage', 'school.manage_settings', 'school.manage_branding', 'school.manage_modules', 'school.manage_api_keys'] }),
    ],
    desktop: [],
  },
  'super-admin': {
    role: 'super-admin',
    homeHref: '/super-admin/command',
    primary: [
      entry('Command', '/super-admin/command', 'super.command', { exact: true, requiredPermission: 'system.audit' }),
      entry('Institutions', '/super-admin/institutions', 'super.institutions', { requiredPermission: 'role.manage' }),
      entry('Operations', '/super-admin/operations', 'super.operations', { requiredPermission: 'system.audit' }),
      entry('Revenue', '/super-admin/revenue', 'super.revenue', { requiredPermission: 'finance.view_revenue' }),
    ],
    more: [
      entry('Governance', '/super-admin/governance', 'super.governance', { requiredPermission: 'role.manage' }),
      entry('Observability', '/super-admin/observability', 'super.observability', { requiredPermission: 'system.audit' }),
      entry('Settings', '/super-admin/settings', 'shared.settings', { requiredPermission: 'system.config' }),
    ],
    desktop: [],
  },
};

for (const manifest of Object.values(ROLE_NAVIGATION)) {
  manifest.desktop = [...manifest.primary, ...manifest.more];
}

export function getRoleManifest(role: ExperienceRole, capabilities?: Readonly<Record<string, boolean>>, permissions?: readonly string[]): RoleManifest {
  const source = ROLE_NAVIGATION[role];
  const permitted = (item: NavigationEntry) => {
    if (capabilities && capabilities[item.capability] !== true) return false;
    // With no permission context this function returns the canonical manifest
    // for design/route ownership. Runtime callers use resolveCapabilities(),
    // which always passes an explicit permission list and therefore fails
    // closed for protected destinations.
    if (permissions === undefined) return true;
    const required = item.requiredPermissions ?? (item.requiredPermission ? [item.requiredPermission] : []);
    return required.length === 0 || required.some((permission) => permissions.includes(permission));
  };
  const manifest = {
    role,
    homeHref: source.homeHref,
    primary: source.primary.filter(permitted),
    more: source.more.filter(permitted),
    desktop: source.desktop.filter(permitted),
  };
  manifestPermissionContext.set(manifest, permissions === undefined ? undefined : new Set(permissions));
  return manifest;
}

const manifestPermissionContext = new WeakMap<RoleManifest, ReadonlySet<string> | undefined>();

export function getManifestPermissionContext(manifest: RoleManifest): ReadonlySet<string> | undefined {
  return manifestPermissionContext.get(manifest);
}
