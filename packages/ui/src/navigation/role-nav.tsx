'use client';

import type { ReactNode } from 'react';
import { CONSUMER_MINIMALISM_FLAGS } from '@alfanumrik/lib/flags/registries/consumer';

export type RoleName = 'student' | 'parent' | 'teacher' | 'schoolAdmin';

export type RoleIconKey =
  | 'today'
  | 'home'
  | 'learn'
  | 'practice'
  | 'foxy'
  | 'profile'
  | 'reports'
  | 'messages'
  | 'calendar'
  | 'more'
  | 'class'
  | 'students'
  | 'assign'
  | 'health'
  | 'teachers'
  | 'classes'
  | 'billing'
  | 'support'
  | 'notifications'
  | 'attendance'
  | 'worksheets'
  | 'gradebook'
  | 'submissions'
  | 'settings'
  | 'logout'
  | 'lock';

export interface RoleNavItem {
  href: string;
  label: string;
  labelHi: string;
  iconKey: RoleIconKey;
  exact?: boolean;
  isPrimaryAction?: boolean;
  badge?: number;
  badgeVariant?: 'default' | 'warning' | 'danger';
  moduleKey?: string;
  flagName?: string;
  overflow?: boolean;
  hiddenInLinkCodeMode?: boolean;
}

export interface RoleNavConfig {
  role: RoleName;
  ariaLabel: string;
  ariaLabelHi: string;
  items: RoleNavItem[];
}

export interface RoleNavVisibility {
  moduleEnablement?: Record<string, boolean> | null;
  flags?: Record<string, boolean> | null;
  linkCodeMode?: boolean;
}

export function getLocalizedRoleNavLabel(item: Pick<RoleNavItem, 'label' | 'labelHi'>, isHi: boolean): string {
  return isHi ? item.labelHi : item.label;
}

export function isRoleNavItemActive(pathname: string | null | undefined, item: Pick<RoleNavItem, 'href' | 'exact'>): boolean {
  const path = pathname || '/';
  if (item.exact) return path === item.href;
  if (item.href === '/') return path === '/';
  return path === item.href || path.startsWith(item.href + '/');
}

export function visibleRoleNavItems<T extends RoleNavItem>(
  items: readonly T[],
  visibility: RoleNavVisibility = {},
): T[] {
  const { moduleEnablement, flags, linkCodeMode } = visibility;
  return items.filter((item) => {
    if (linkCodeMode && item.hiddenInLinkCodeMode) return false;

    if (item.moduleKey && moduleEnablement && moduleEnablement[item.moduleKey] === false) {
      return false;
    }

    if (item.flagName && flags && flags[item.flagName] === false) {
      return false;
    }

    return true;
  });
}

export function splitRoleNavItems<T extends RoleNavItem>(
  items: readonly T[],
  maxVisible = 5,
): { primary: T[]; overflow: T[] } {
  const explicitPrimary = items.filter((item) => !item.overflow);
  const explicitOverflow = items.filter((item) => item.overflow);

  if (explicitOverflow.length > 0) {
    return {
      primary: explicitPrimary.slice(0, maxVisible),
      overflow: [...explicitPrimary.slice(maxVisible), ...explicitOverflow],
    };
  }

  return {
    primary: explicitPrimary.slice(0, maxVisible),
    overflow: explicitPrimary.slice(maxVisible),
  };
}

export const ROLE_NAV_CONFIGS: Record<RoleName, RoleNavConfig> = {
  student: {
    role: 'student',
    ariaLabel: 'Student navigation',
    ariaLabelHi: 'छात्र नेविगेशन',
    items: [
      { href: '/today', label: 'Today', labelHi: 'आज', iconKey: 'today', exact: true, flagName: CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1 },
      { href: '/learn', label: 'Learn', labelHi: 'सीखें', iconKey: 'learn' },
      { href: '/practice', label: 'Practice', labelHi: 'अभ्यास', iconKey: 'practice' },
      { href: '/foxy', label: 'Foxy', labelHi: 'फॉक्सी', iconKey: 'foxy', isPrimaryAction: true },
      { href: '/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', iconKey: 'profile' },
      { href: '/dashboard', label: 'Dashboard', labelHi: 'डैशबोर्ड', iconKey: 'home', overflow: true },
      { href: '/progress', label: 'Progress', labelHi: 'प्रगति', iconKey: 'reports', overflow: true },
      { href: '/reports', label: 'Reports', labelHi: 'रिपोर्ट', iconKey: 'reports', overflow: true },
      { href: '/simulations', label: 'STEM Lab', labelHi: 'STEM लैब', iconKey: 'learn', overflow: true },
      { href: '/leaderboard', label: 'Rewards', labelHi: 'पुरस्कार', iconKey: 'settings', overflow: true },
    ],
  },
  parent: {
    role: 'parent',
    ariaLabel: 'Parent navigation',
    ariaLabelHi: 'अभिभावक नेविगेशन',
    items: [
      { href: '/parent', label: 'Home', labelHi: 'होम', iconKey: 'home', exact: true },
      { href: '/parent/reports', label: 'Reports', labelHi: 'रिपोर्ट', iconKey: 'reports' },
      { href: '/parent/messages', label: 'Messages', labelHi: 'संदेश', iconKey: 'messages', hiddenInLinkCodeMode: true },
      { href: '/parent/calendar', label: 'Calendar', labelHi: 'कैलेंडर', iconKey: 'calendar' },
      { href: '/parent/children', label: 'Children', labelHi: 'बच्चे', iconKey: 'students', overflow: true, hiddenInLinkCodeMode: true },
      { href: '/parent/attendance', label: 'Attendance', labelHi: 'उपस्थिति', iconKey: 'attendance', overflow: true },
      { href: '/parent/notifications', label: 'Notifications', labelHi: 'सूचनाएँ', iconKey: 'notifications', overflow: true, hiddenInLinkCodeMode: true },
      { href: '/parent/billing', label: 'Billing', labelHi: 'बिलिंग', iconKey: 'billing', overflow: true, hiddenInLinkCodeMode: true },
      { href: '/parent/support', label: 'Support', labelHi: 'सहायता', iconKey: 'support', overflow: true },
      { href: '/parent/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', iconKey: 'profile', overflow: true, hiddenInLinkCodeMode: true },
    ],
  },
  teacher: {
    role: 'teacher',
    ariaLabel: 'Teacher navigation',
    ariaLabelHi: 'शिक्षक नेविगेशन',
    items: [
      { href: '/teacher', label: 'Class', labelHi: 'कक्षा', iconKey: 'class', exact: true },
      { href: '/teacher/students', label: 'Students', labelHi: 'छात्र', iconKey: 'students' },
      { href: '/teacher/assignments', label: 'Assign', labelHi: 'असाइन', iconKey: 'assign', moduleKey: 'assignments' },
      { href: '/teacher/messages', label: 'Messages', labelHi: 'संदेश', iconKey: 'messages' },
      { href: '/teacher/classes', label: 'Classes', labelHi: 'कक्षाएं', iconKey: 'classes', overflow: true },
      { href: '/teacher/grade-book', label: 'Gradebook', labelHi: 'ग्रेड बुक', iconKey: 'gradebook', overflow: true, moduleKey: 'assignments' },
      { href: '/teacher/reports', label: 'Reports', labelHi: 'रिपोर्ट', iconKey: 'reports', overflow: true, moduleKey: 'analytics' },
      { href: '/teacher/submissions', label: 'Submissions', labelHi: 'सबमिशन', iconKey: 'submissions', overflow: true, moduleKey: 'assignments' },
      { href: '/teacher/worksheets', label: 'Worksheets', labelHi: 'वर्कशीट', iconKey: 'worksheets', overflow: true, moduleKey: 'lms' },
      { href: '/teacher/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', iconKey: 'profile', overflow: true },
    ],
  },
  schoolAdmin: {
    role: 'schoolAdmin',
    ariaLabel: 'School admin navigation',
    ariaLabelHi: 'स्कूल प्रशासन नेविगेशन',
    items: [
      { href: '/school-admin', label: 'Health', labelHi: 'स्वास्थ्य', iconKey: 'health', exact: true },
      { href: '/school-admin/classes', label: 'Classes', labelHi: 'कक्षाएं', iconKey: 'classes' },
      { href: '/school-admin/teachers', label: 'Teachers', labelHi: 'शिक्षक', iconKey: 'teachers' },
      { href: '/school-admin/reports', label: 'Reports', labelHi: 'रिपोर्ट', iconKey: 'reports' },
      { href: '/school-admin/students', label: 'Students', labelHi: 'छात्र', iconKey: 'students', overflow: true },
      { href: '/school-admin/parents', label: 'Parents', labelHi: 'अभिभावक', iconKey: 'students', overflow: true },
      { href: '/school-admin/invite-codes', label: 'Invite Codes', labelHi: 'कोड', iconKey: 'notifications', overflow: true },
      { href: '/school-admin/modules', label: 'Modules', labelHi: 'मॉड्यूल', iconKey: 'settings', overflow: true },
      { href: '/school-admin/billing', label: 'Billing', labelHi: 'बिलिंग', iconKey: 'billing', overflow: true },
      { href: '/school-admin/setup', label: 'Setup', labelHi: 'सेटअप', iconKey: 'settings', overflow: true },
    ],
  },
};

const iconStrokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 2,
};

function Svg({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable="false">
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export function RoleNavIcon({ iconKey, title }: { iconKey: RoleIconKey; title?: string }) {
  switch (iconKey) {
    case 'today':
      return <Svg title={title}><circle cx="12" cy="12" r="4" {...iconStrokeProps} /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" {...iconStrokeProps} /></Svg>;
    case 'home':
      return <Svg title={title}><path d="M3 11.5 12 4l9 7.5" {...iconStrokeProps} /><path d="M5.5 10.5V20h13v-9.5" {...iconStrokeProps} /><path d="M9.5 20v-5h5v5" {...iconStrokeProps} /></Svg>;
    case 'learn':
      return <Svg title={title}><path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 0-3-3V4.5Z" {...iconStrokeProps} /><path d="M8 8h6M8 11h5" {...iconStrokeProps} /></Svg>;
    case 'practice':
      return <Svg title={title}><path d="M5 19 19 5" {...iconStrokeProps} /><path d="M14 5h5v5" {...iconStrokeProps} /><path d="M6 6h5M6 10h3M13 18h5" {...iconStrokeProps} /></Svg>;
    case 'foxy':
      return <Svg title={title}><path d="M5 8 3 3l5 2 4-2 4 2 5-2-2 5v5a7 7 0 0 1-14 0V8Z" {...iconStrokeProps} /><path d="M9 12h.01M15 12h.01M10 16h4" {...iconStrokeProps} /></Svg>;
    case 'profile':
      return <Svg title={title}><circle cx="12" cy="8" r="3.5" {...iconStrokeProps} /><path d="M5 20a7 7 0 0 1 14 0" {...iconStrokeProps} /></Svg>;
    case 'reports':
      return <Svg title={title}><path d="M5 20V4h14v16H5Z" {...iconStrokeProps} /><path d="M9 16V11M12 16V8M15 16v-3" {...iconStrokeProps} /></Svg>;
    case 'messages':
      return <Svg title={title}><path d="M4 5h16v11H8l-4 4V5Z" {...iconStrokeProps} /><path d="M8 9h8M8 12h5" {...iconStrokeProps} /></Svg>;
    case 'calendar':
      return <Svg title={title}><path d="M5 5h14v15H5V5Z" {...iconStrokeProps} /><path d="M8 3v4M16 3v4M5 10h14" {...iconStrokeProps} /></Svg>;
    case 'class':
      return <Svg title={title}><path d="M4 6h16v12H4V6Z" {...iconStrokeProps} /><path d="M8 10h8M8 14h5" {...iconStrokeProps} /></Svg>;
    case 'students':
      return <Svg title={title}><circle cx="9" cy="8" r="3" {...iconStrokeProps} /><circle cx="17" cy="10" r="2.2" {...iconStrokeProps} /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M14.5 17.5a4.4 4.4 0 0 1 6 2.5" {...iconStrokeProps} /></Svg>;
    case 'assign':
      return <Svg title={title}><path d="M6 4h9l3 3v13H6V4Z" {...iconStrokeProps} /><path d="M14 4v4h4M9 12h6M9 16h4" {...iconStrokeProps} /></Svg>;
    case 'health':
      return <Svg title={title}><path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z" {...iconStrokeProps} /><path d="M8 12h2l1-2 2 5 1-3h2" {...iconStrokeProps} /></Svg>;
    case 'teachers':
      return <Svg title={title}><circle cx="12" cy="7.5" r="3" {...iconStrokeProps} /><path d="M5 20a7 7 0 0 1 14 0M17 6h4v8h-3" {...iconStrokeProps} /></Svg>;
    case 'classes':
      return <Svg title={title}><path d="M4 5h16v14H4V5Z" {...iconStrokeProps} /><path d="M8 9h8M8 13h8M8 17h5" {...iconStrokeProps} /></Svg>;
    case 'billing':
      return <Svg title={title}><path d="M4 7h16v10H4V7Z" {...iconStrokeProps} /><path d="M4 10h16M8 14h4" {...iconStrokeProps} /></Svg>;
    case 'support':
      return <Svg title={title}><circle cx="12" cy="12" r="9" {...iconStrokeProps} /><path d="M9.5 9a2.8 2.8 0 1 1 4.8 2c-.9.8-1.8 1.3-1.8 2.7M12 17h.01" {...iconStrokeProps} /></Svg>;
    case 'notifications':
      return <Svg title={title}><path d="M18 16H6l1.4-2.2V10a4.6 4.6 0 0 1 9.2 0v3.8L18 16Z" {...iconStrokeProps} /><path d="M10 18a2 2 0 0 0 4 0" {...iconStrokeProps} /></Svg>;
    case 'attendance':
      return <Svg title={title}><path d="m5 12 4 4 10-10" {...iconStrokeProps} /></Svg>;
    case 'worksheets':
    case 'submissions':
    case 'gradebook':
      return <Svg title={title}><path d="M6 4h12v16H6V4Z" {...iconStrokeProps} /><path d="M9 8h6M9 12h6M9 16h3" {...iconStrokeProps} /></Svg>;
    case 'settings':
      return <Svg title={title}><circle cx="12" cy="12" r="3" {...iconStrokeProps} /><path d="M12 3v2M12 19v2M4.2 7.5l1.7 1M18.1 15.5l1.7 1M4.2 16.5l1.7-1M18.1 8.5l1.7-1" {...iconStrokeProps} /></Svg>;
    case 'logout':
      return <Svg title={title}><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" {...iconStrokeProps} /></Svg>;
    case 'lock':
      return <Svg title={title}><path d="M7 11h10v9H7v-9ZM9 11V8a3 3 0 0 1 6 0v3" {...iconStrokeProps} /></Svg>;
    case 'more':
    default:
      return <Svg title={title}><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /></Svg>;
  }
}
