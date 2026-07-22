import { type UserRole } from '@alfanumrik/lib/AuthContext';
import { ROLE_CONFIG } from '@alfanumrik/lib/constants';

// Consumer Minimalism Wave A — the 4-tab student model (always-on).
// Today is the home tab (carries the streak badge); Me routes to /progress.
// Foxy stays the center FAB.
export const CORE_TABS = [
  { href: '/today', icon: '☀️', activeIcon: '☀️', label: 'Today', labelHi: 'आज' },
  { href: '/learn', icon: '📚', activeIcon: '📚', label: 'Learn', labelHi: 'सीखें' },
  { href: '/foxy', icon: '🦊', activeIcon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी', isFab: true },
  { href: '/progress', icon: '🙂', activeIcon: '🙂', label: 'Me', labelHi: 'मैं' },
];

export const MORE_ITEMS = [
  { href: '/dashboard', icon: '🏠', label: 'Dashboard', labelHi: 'डैशबोर्ड' },
  { href: '/assignments', icon: '📋', label: 'Assignments', labelHi: 'असाइनमेंट' },
  { href: '/stem-centre', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब' },
  // Alfa OS Practice Center — flag-gated (ff_practice_os_v1). A v2 practice hub
  // over the existing /quiz engine; only appears once its launch flag is ON.
  { href: '/practice', icon: '⚡', label: 'Practice Center', labelHi: 'अभ्यास केंद्र', flagName: 'ff_practice_os_v1' },
  { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9 },
  { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9 },
  // Alfa OS pre-test briefing hub — flag-gated (ff_test_os_v1). The single
  // "Start an exam" front door; hands off to the existing exam runtime.
  { href: '/exam-briefing', icon: '🧭', label: 'Exam Briefing', labelHi: 'परीक्षा ब्रीफ़िंग', flagName: 'ff_test_os_v1' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड' },
  { href: '/library', icon: '📚', label: 'Library', labelHi: 'अध्ययन सामग्री' },
  { href: '/refresh', icon: '🔁', label: 'Refresh', labelHi: 'ताज़ा करो' },
  // Alfa OS Revision Center — flag-gated (ff_revision_os_v1). A v2 spaced-
  // repetition revision hub; only appears once its launch flag is ON.
  { href: '/revision', icon: '🧠', label: 'Revision Center', labelHi: 'दोहराव केंद्र', flagName: 'ff_revision_os_v1' },
  { href: '/exam-prep', icon: '🎯', label: 'Exam Sprint', labelHi: 'परीक्षा की तैयारी', requiresUpcomingExam: true },
  { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
  { href: '/notifications', icon: '🔔', label: 'Settings & Notifications', labelHi: 'सेटिंग्स और सूचनाएँ' },
  { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
  { href: '/support', icon: '📨', label: 'My Tickets', labelHi: 'मेरे टिकट' },
];

export const SIDEBAR_SECTIONS = [
  {
    title: 'Home', titleHi: 'होम',
    items: [
      { href: '/dashboard', icon: '🏠', label: 'Home', labelHi: 'होम' },
      { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी' },
      { href: '/progress', icon: '📈', label: 'My Progress', labelHi: 'मेरी प्रगति' },
    ],
  },
  {
    title: 'Practice', titleHi: 'अभ्यास',
    items: [
      // Alfa OS Practice Center (flag-gated) — v2 hub above the /quiz engine.
      { href: '/practice', icon: '⚡', label: 'Practice Center', labelHi: 'अभ्यास केंद्र', flagName: 'ff_practice_os_v1' },
      { href: '/quiz', icon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
      { href: '/assignments', icon: '📋', label: 'Assignments', labelHi: 'असाइनमेंट' },
      { href: '/stem-centre', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब' },
      { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9 },
      { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9 },
      // Alfa OS pre-test briefing hub (flag-gated) — the "Start an exam" front door.
      { href: '/exam-briefing', icon: '🧭', label: 'Exam Briefing', labelHi: 'परीक्षा ब्रीफ़िंग', flagName: 'ff_test_os_v1' },
    ],
  },
  {
    title: 'Study', titleHi: 'पढ़ाई',
    items: [
      { href: '/library',   icon: '📚', label: 'Library',     labelHi: 'अध्ययन सामग्री' },
      { href: '/refresh',   icon: '🔁', label: 'Refresh',     labelHi: 'ताज़ा करो' },
      // Alfa OS Revision Center (flag-gated) — v2 spaced-repetition revision hub.
      { href: '/revision',  icon: '🧠', label: 'Revision Center', labelHi: 'दोहराव केंद्र', flagName: 'ff_revision_os_v1' },
      { href: '/exam-prep', icon: '🎯', label: 'Exam Sprint', labelHi: 'परीक्षा की तैयारी', requiresUpcomingExam: true },
    ],
  },
  {
    title: 'Account', titleHi: 'खाता',
    items: [
      { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
      { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
      { href: '/support', icon: '📨', label: 'My Tickets', labelHi: 'मेरे टिकट' },
    ],
  },
];

export interface NavGradeGatedItem {
  gradeMin?: number;
  [key: string]: unknown;
}

export function getItemLockForGrade(
  item: NavGradeGatedItem | null | undefined,
  studentGrade: number,
): { locked: boolean; gradeMin?: number } {
  const gMin = item?.gradeMin;
  if (typeof gMin === 'number' && studentGrade < gMin) {
    return { locked: true, gradeMin: gMin };
  }
  return { locked: false };
}

export interface NavFlagGatedItem {
  flagName?: string;
  [key: string]: unknown;
}

export function isItemVisibleForFlags(
  item: NavFlagGatedItem | null | undefined,
  flags: Record<string, boolean> | undefined | null,
): boolean {
  const name = item?.flagName;
  if (!name) return true;
  return flags?.[name] === true;
}

export function getCoreTabs(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, activeIcon: n.icon, label: n.label, labelHi: n.labelHi }));
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, activeIcon: n.icon, label: n.label, labelHi: n.labelHi }));
  }
  return CORE_TABS;
}

export function getMoreItems(role: UserRole) {
  if (role === 'teacher') {
    return ROLE_CONFIG.teacher.nav.slice(4).map(item => ({
      href: item.href, icon: item.icon, label: item.label, labelHi: item.labelHi,
    }));
  }
  if (role === 'guardian') {
    return ROLE_CONFIG.guardian.nav.slice(4).map(item => ({
      href: item.href, icon: item.icon, label: item.label, labelHi: item.labelHi,
    }));
  }
  return MORE_ITEMS;
}

export function getSidebarSections(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return [
      {
        title: 'Teaching', titleHi: 'शिक्षण',
        items: nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
      {
        title: 'Account', titleHi: 'खाता',
        items: nav.slice(4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
    ];
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return [
      {
        title: 'Family', titleHi: 'परिवार',
        items: nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
      {
        title: 'Account', titleHi: 'खाता',
        items: nav.slice(4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
    ];
  }
  return SIDEBAR_SECTIONS;
}
