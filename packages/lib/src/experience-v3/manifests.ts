import type { ExperienceRole, NavigationEntry, RoleManifest } from './types';

const entry = (label: string, href: string, capability: string, options: Partial<NavigationEntry> = {}): NavigationEntry => ({ label, href, capability, ...options });

export const ROLE_NAVIGATION: Readonly<Record<ExperienceRole, RoleManifest>> = {
  student: {
    role: 'student',
    homeHref: '/today',
    primary: [
      entry('Today', '/today', 'student.today', { exact: true }),
      entry('Learn', '/learn', 'student.learn'),
      entry('Practice', '/practice', 'student.practice'),
      entry('Progress', '/progress', 'student.progress'),
    ],
    more: [
      entry('Foxy history', '/foxy', 'student.foxy'),
      entry('Rewards', '/rewards', 'student.rewards'),
      entry('Notebook', '/notebook', 'student.notebook'),
      entry('Exam plan', '/practice/exam', 'student.exam-plan'),
      entry('Downloads', '/downloads', 'student.downloads'),
      entry('Settings', '/settings', 'shared.settings'),
      entry('Help', '/help', 'shared.help'),
      entry('Switch role', '/role-switch', 'shared.role-switch'),
    ],
    desktop: [],
  },
  teacher: {
    role: 'teacher',
    homeHref: '/teacher/today',
    primary: [
      entry('Today', '/teacher/today', 'teacher.today', { exact: true }),
      entry('Students', '/teacher/students', 'teacher.students'),
      entry('Assign', '/teacher/assign', 'teacher.assign'),
      entry('Inbox', '/teacher/messages', 'teacher.messages'),
    ],
    more: [
      entry('Classes', '/teacher/classes', 'teacher.classes'),
      entry('Grade', '/teacher/grade', 'teacher.grade'),
      entry('Insights', '/teacher/insights', 'teacher.insights'),
      entry('Resources', '/teacher/resources', 'teacher.resources'),
      entry('Settings', '/teacher/settings', 'shared.settings'),
    ],
    desktop: [],
  },
  parent: {
    role: 'parent',
    homeHref: '/parent/home',
    primary: [
      entry('Home', '/parent/home', 'parent.home', { exact: true }),
      entry('Progress', '/parent/progress', 'parent.progress'),
      entry('Plan', '/parent/plan', 'parent.plan'),
      entry('Messages', '/parent/messages', 'parent.messages'),
    ],
    more: [
      entry('Calendar', '/parent/calendar', 'parent.calendar'),
      entry('Reports', '/parent/reports', 'parent.reports'),
      entry('Settings', '/parent/settings', 'shared.settings'),
      entry('Help', '/help', 'shared.help'),
      entry('Switch role', '/role-switch', 'shared.role-switch'),
    ],
    desktop: [],
  },
  'school-admin': {
    role: 'school-admin',
    homeHref: '/school-admin/overview',
    primary: [
      entry('Overview', '/school-admin/overview', 'school.overview', { exact: true }),
      entry('People', '/school-admin/people', 'school.people'),
      entry('Academics', '/school-admin/academics', 'school.academics'),
      entry('Insights', '/school-admin/insights', 'school.insights'),
    ],
    more: [
      entry('Announcements', '/school-admin/announcements', 'school.announcements'),
      entry('Reports', '/school-admin/reports', 'school.reports'),
      entry('Governance', '/school-admin/governance', 'school.governance', { requiredPermission: 'institution.manage' }),
      entry('Settings', '/school-admin/settings', 'shared.settings', { requiredPermission: 'institution.manage' }),
    ],
    desktop: [],
  },
  'super-admin': {
    role: 'super-admin',
    homeHref: '/super-admin/command',
    primary: [
      entry('Command', '/super-admin/command', 'super.command', { exact: true }),
      entry('Institutions', '/super-admin/institutions', 'super.institutions'),
      entry('Operations', '/super-admin/operations', 'super.operations'),
      entry('Revenue', '/super-admin/revenue', 'super.revenue'),
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
    return !item.requiredPermission || permissions === undefined || permissions.includes(item.requiredPermission);
  };
  return {
    role,
    homeHref: source.homeHref,
    primary: source.primary.filter(permitted),
    more: source.more.filter(permitted),
    desktop: source.desktop.filter(permitted),
  };
}
