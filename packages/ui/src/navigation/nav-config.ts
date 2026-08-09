import { type UserRole } from '@alfanumrik/lib/AuthContext';
import { ROLE_CONFIG } from '@alfanumrik/lib/constants';

// ─── The student primary navigation (2026-08-09) ───────────────────────────
//
// FIVE primary slots, one fixed order, identical labels + destinations + order
// at EVERY breakpoint. Only the PRESENTATION changes across tiers:
//
//   360–767px   → five-item bottom bar          (MobileBottomNav)
//   768–1023px  → vertical navigation rail      (TabletNavRail)
//   1024px+     → persistent sidebar            (DesktopSidebar)
//
//   1. Today  2. Learn  3. Practice  4. Progress  5. More
//
// CORE_TABS is the four primary DESTINATIONS; "More" is the fifth slot and is
// an overflow control, not a destination, so it carries no href and is supplied
// by resolveStudentPrimaryNav() below. Consumers that need all five slots in
// order (all three tier components do) must call resolveStudentPrimaryNav()
// rather than reading CORE_TABS directly.
//
// IA CHANGE — Foxy left the primary bar. It previously occupied slot 3 as a
// raised centre FAB. Per the navigation spec, Foxy / profile / notifications /
// search are UTILITIES, not primary destinations, so `/foxy` moved into the
// More sheet's "Utilities" group (its first entry) and into the desktop
// sidebar's new "Utilities" section. `/practice` took the vacated primary
// slot. `/foxy` itself is untouched as a route and its deep links still work;
// /foxy also keeps suppressing all nav chrome, as before.
//
// IA law "one destination = one name = one icon" (2026-08-05). `/progress` was
// "Me" 🙂 here and "My Progress" 📈 in SIDEBAR_SECTIONS — one route wearing two
// names and two icons across viewports, and colliding with the `/me` and
// `/profile` entries below. It is now "Progress" 📈 in BOTH lists. No route
// changed; the labels/icons did.
export const CORE_TABS = [
  { href: '/today', icon: '☀️', activeIcon: '☀️', label: 'Today', labelHi: 'आज' },
  { href: '/learn', icon: '📚', activeIcon: '📚', label: 'Learn', labelHi: 'सीखें' },
  // Slot 3 — see PRACTICE FLAG CONTRACT in resolveStudentPrimaryNav().
  { href: '/practice', icon: '⚡', activeIcon: '⚡', label: 'Practice', labelHi: 'अभ्यास' },
  { href: '/progress', icon: '📈', activeIcon: '📈', label: 'Progress', labelHi: 'प्रगति' },
];

export const MORE_ITEMS = [
  // Was "Dashboard" here and "Home" in SIDEBAR_SECTIONS — one route, two names
  // (same icon). Found by the cross-projection guard added alongside the
  // /progress fix; unified to the sidebar's "Home", which is what the route is
  // to a student. Destination unchanged.
  // 2026-08-06 declutter: items carry a `group` so the More sheet can render
  // section headers instead of one flat 19-item list. `group` is a sheet-only
  // projection concern — SIDEBAR_SECTIONS already groups by section.
  { href: '/dashboard', icon: '🏠', label: 'Home', labelHi: 'होम' },
  // 2026-08-09 — Foxy is a UTILITY, not a primary destination. It used to be
  // the raised centre FAB in CORE_TABS; the navigation spec reserves the five
  // primary slots for Today / Learn / Practice / Progress / More and classes
  // Foxy alongside profile, notifications and search. It leads the utilities
  // group so it stays one interaction away on phones.
  { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी', group: 'utilities' },
  { href: '/assignments', icon: '📋', label: 'Assignments', labelHi: 'असाइनमेंट', group: 'practice' },
  { href: '/stem-centre', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब', group: 'practice' },
  // /practice is NOT listed here any more — it is primary slot 3. See the
  // PRACTICE FLAG CONTRACT note on resolveStudentPrimaryNav().
  { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9, group: 'practice' },
  { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9, group: 'practice' },
  // Alfa OS pre-test briefing hub — flag-gated (ff_test_os_v1). The single
  // "Start an exam" front door; hands off to the existing exam runtime.
  { href: '/exam-briefing', icon: '🧭', label: 'Exam Briefing', labelHi: 'परीक्षा ब्रीफ़िंग', flagName: 'ff_test_os_v1', group: 'practice' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड', group: 'study' },
  { href: '/library', icon: '📚', label: 'Library', labelHi: 'अध्ययन सामग्री', group: 'study' },
  { href: '/refresh', icon: '🔁', label: 'Refresh', labelHi: 'ताज़ा करो', group: 'study' },
  // Alfa OS Revision Center — flag-gated (ff_revision_os_v1). A v2 spaced-
  // repetition revision hub; only appears once its launch flag is ON.
  { href: '/revision', icon: '🧠', label: 'Revision Center', labelHi: 'दोहराव केंद्र', flagName: 'ff_revision_os_v1', group: 'study' },
  { href: '/exam-prep', icon: '🎯', label: 'Exam Sprint', labelHi: 'परीक्षा की तैयारी', requiresUpcomingExam: true, group: 'practice' },
  { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल', group: 'account' },
  // Wave B gap screen 16 "Me" — flag-gated (ff_me_v2). Additive presentation
  // layer over /profile (apps/host/src/app/me/page.tsx); only appears once
  // the launch flag is ON, same convention as Practice Center / Revision
  // Center above.
  // Label was "Me (New)" — a build-status marker leaking into student-facing
  // UI, and one of the THREE things called "Me" (the others were the /progress
  // tab and /profile). With /progress renamed to "Progress", plain "Me" is now
  // unambiguous and is the screen's real name.
  { href: '/me', icon: '⚙️', label: 'Me', labelHi: 'मैं', flagName: 'ff_me_v2', group: 'account' },
  // Foxy North-Star Phase 1 — learner-memory transparency + erasure screen.
  { href: '/memory', icon: '🦊', label: 'What Foxy remembers', labelHi: 'फॉक्सी क्या याद रखता है', group: 'utilities' },
  { href: '/notifications', icon: '🔔', label: 'Settings & Notifications', labelHi: 'सेटिंग्स और सूचनाएँ', group: 'utilities' },
  { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट', group: 'account' },
  { href: '/support', icon: '📨', label: 'My Tickets', labelHi: 'मेरे टिकट', group: 'account' },
];

/** More-sheet section headers (mobile overflow projection only). `group` on a
 *  MORE_ITEMS entry references these. Ungrouped items render at the top, then
 *  groups in this order. Mirrors SIDEBAR_SECTIONS' Practice/Study/Account
 *  grouping so both projections share the same mental model (IA law). */
export const MORE_SHEET_GROUPS: { key: string; en: string; hi: string }[] = [
  // Utilities first — Foxy, notifications and the memory screen are the
  // things a student reaches for mid-session, and Foxy in particular lost its
  // centre-FAB slot when the five primary destinations were fixed.
  { key: 'utilities', en: 'Utilities', hi: 'उपयोगिताएँ' },
  // Header text intentionally still "Practice" (not renamed alongside the new
  // primary Practice slot): these are the practice surfaces that did NOT get a
  // primary slot, and an existing regression test pins this header string.
  { key: 'practice', en: 'Practice', hi: 'अभ्यास' },
  { key: 'study', en: 'Study', hi: 'पढ़ाई' },
  { key: 'account', en: 'Account', hi: 'खाता' },
];

export const SIDEBAR_SECTIONS = [
  {
    // 2026-08-09 — was titled "Home" while also containing an item called
    // "Home". Retitled "Main" and rebuilt to hold the FIVE primary
    // destinations in the spec order (Today · Learn · Practice · Progress,
    // plus /dashboard which is the student's literal home route). This is the
    // desktop projection of the same ordered set the bottom bar and the tablet
    // rail render — same labels, same icons, same order, different chrome.
    //
    // `/learn` was previously ABSENT from the sidebar entirely: a primary
    // destination that existed at 360px and vanished at 1024px. Added here.
    // `/today` moved in from DesktopSidebar's imperative injection — the
    // ff_today_home_v1 gate is preserved declaratively via flagName, which
    // isItemVisibleForFlags already enforces on this list.
    title: 'Main', titleHi: 'मुख्य',
    items: [
      { href: '/today', icon: '☀️', label: 'Today', labelHi: 'आज', flagName: 'ff_today_home_v1' },
      { href: '/dashboard', icon: '🏠', label: 'Home', labelHi: 'होम' },
      { href: '/learn', icon: '📚', label: 'Learn', labelHi: 'सीखें' },
      { href: '/practice', icon: '⚡', label: 'Practice', labelHi: 'अभ्यास' },
      // Matches CORE_TABS exactly — same name, same icon, same route.
      { href: '/progress', icon: '📈', label: 'Progress', labelHi: 'प्रगति' },
    ],
  },
  {
    title: 'Practice', titleHi: 'अभ्यास',
    items: [
      // /practice moved to the Main section above — it is primary slot 3 now,
      // and is no longer flag-gated in NAV (the route itself still resolves
      // ff_practice_os_v1; see the PRACTICE FLAG CONTRACT note below).
      //
      // Was labelled "Practice" — identical to this section's own title and a
      // near-twin of "Practice Center" one line above, so the section read
      // "Practice > Practice Center / Practice". Renamed to what the route
      // actually is. The destination is unchanged.
      { href: '/quiz', icon: '✏️', label: 'Quiz', labelHi: 'क्विज़' },
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
    // 2026-08-09 — new section. Foxy left the primary bar (it was the centre
    // FAB); it and the other non-destination affordances the spec calls
    // utilities live here, mirroring the More sheet's "Utilities" group so
    // both projections carry the same mental model.
    title: 'Utilities', titleHi: 'उपयोगिताएँ',
    items: [
      { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी' },
      // Foxy North-Star Phase 1 — learner-memory transparency + erasure screen.
      { href: '/memory', icon: '🦊', label: 'What Foxy remembers', labelHi: 'फॉक्सी क्या याद रखता है' },
      { href: '/notifications', icon: '🔔', label: 'Settings & Notifications', labelHi: 'सेटिंग्स और सूचनाएँ' },
    ],
  },
  {
    title: 'Account', titleHi: 'खाता',
    items: [
      { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
      // Wave B gap screen 16 "Me" — flag-gated (ff_me_v2). See MORE_ITEMS above
      // for the full rationale (including the "Me (New)" rename); mirrored here
      // so the desktop sidebar surfaces the same additive screen once the flag
      // ramps, under the same name and icon.
      { href: '/me', icon: '⚙️', label: 'Me', labelHi: 'मैं', flagName: 'ff_me_v2' },
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

/**
 * Shared active-state matcher for every nav projection (bottom tabs, More
 * sheet, sidebar). RCA W2: both components used to inline
 * `pathname.startsWith(href)` — a prefix match with NO segment boundary — so
 * `/me` lit up on `/memory` and `/mock-exam`, and any shorter href matched any
 * longer sibling. Segment-boundary matching keeps descendant pages active
 * (`/learn/math/1` → `/learn`) while forbidding cross-route prefix collisions.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (pathname === href) return true;
  return pathname.startsWith(href + '/');
}

export function isItemVisibleForFlags(
  item: NavFlagGatedItem | null | undefined,
  flags: Record<string, boolean> | undefined | null,
): boolean {
  const name = item?.flagName;
  if (!name) return true;
  return flags?.[name] === true;
}

/* ───────────────────────────────────────────────────────────────────────────
 * ONE typed, capability-aware primary navigation, reused by all three tiers.
 *
 * MobileBottomNav (< 768), TabletNavRail (768–1023) and DesktopSidebar (1024+)
 * all read resolveStudentPrimaryNav(). They differ only in chrome: the same
 * five slots, the same labels, the same destinations, the same order.
 * ─────────────────────────────────────────────────────────────────────────── */

export type StudentNavSlotId = 'today' | 'learn' | 'practice' | 'progress' | 'more';

/** The order is a product contract, not a rendering detail. */
export const STUDENT_PRIMARY_ORDER: readonly StudentNavSlotId[] = [
  'today',
  'learn',
  'practice',
  'progress',
  'more',
] as const;

export interface StudentNavCapabilities {
  /** Resolved feature flags. `undefined` = not yet loaded (treated as OFF). */
  flags?: Record<string, boolean> | null;
  /** Student grade as a number (P5: grades are strings at the boundary). */
  grade?: number;
  /** Whether the learner has an exam within the sprint window. */
  hasUpcomingExam?: boolean;
}

export interface ResolvedNavSlot {
  id: StudentNavSlotId;
  /** `destination` navigates; `overflow` opens the More sheet. */
  kind: 'destination' | 'overflow';
  /** null only for the overflow slot. */
  href: string | null;
  icon: string;
  activeIcon: string;
  label: string;
  labelHi: string;
  /**
   * Extra pathnames that should also mark this slot current. Used where a
   * destination legitimately lands the student somewhere else (see the
   * PRACTICE FLAG CONTRACT below) so the bar never shows zero active slots.
   */
  altHrefs: string[];
  /**
   * Accessible name when it must differ from the visible label. The overflow
   * slot reads "More options" to screen readers (it opens a sheet, it does not
   * navigate) while showing the shorter visible "More".
   */
  a11yLabel?: string;
  a11yLabelHi?: string;
  /** Optional decoration the tier components may render. */
  badge?: 'streak';
}

const MORE_SLOT: ResolvedNavSlot = {
  id: 'more',
  kind: 'overflow',
  href: null,
  icon: '☰',
  activeIcon: '☰',
  label: 'More',
  labelHi: 'और',
  a11yLabel: 'More options',
  a11yLabelHi: 'अधिक विकल्प',
  altHrefs: [],
};

/** The overflow slot, exported so every tier renders the identical fifth slot. */
export const STUDENT_MORE_SLOT: ResolvedNavSlot = MORE_SLOT;

/**
 * The five primary slots for the student role, in the fixed spec order.
 *
 * PRACTICE FLAG CONTRACT (`ff_practice_os_v1`)
 * --------------------------------------------
 * The Practice SLOT is permanent — the bar is five items in every flag state,
 * never four. The flag governs what `/practice` RENDERS, not whether the slot
 * exists:
 *
 *   flag ON  → `/practice` renders the Alfa OS Practice Center hub.
 *   flag OFF → `/practice` immediately `router.replace('/quiz')` — the live
 *              quiz engine. This is pre-existing, already-shipped behaviour of
 *              `apps/host/src/app/(student)/practice/page.tsx`, not something
 *              introduced here; the route has always been a non-route when the
 *              flag is off rather than a 404.
 *
 * So the slot is never dead and never silently disappears, and no flag has to
 * be graduated to satisfy the five-destination contract. `altHrefs: ['/quiz']`
 * keeps the slot marked `aria-current="page"` after the flag-OFF redirect.
 * (On a surface that ALSO lists `/quiz` in its own right — the desktop sidebar
 * does — `resolveActiveNavHref` prefers the longer exact match, so `/quiz`
 * wins there and only one item is ever current.)
 *
 * TODAY FLAG CONTRACT (`ff_today_home_v1`) — identical shape
 * ---------------------------------------------------------
 * `/today` with the flag OFF does `router.replace('/dashboard')`
 * (`apps/host/src/app/today/page.tsx`), so the Today slot's real landing page
 * is `/dashboard` for every student until that flag ramps. Without
 * `altHrefs: ['/dashboard']` the bar would show ZERO current destinations on
 * the app's own home route — measured in Chromium at 360px before this was
 * added. When the flag is ON, `/dashboard` is still reachable from the More
 * sheet and will also mark the Today slot current; both are "home", so that
 * is the intended reading rather than a collision.
 */
export function resolveStudentPrimaryNav(
  caps: StudentNavCapabilities = {},
): ResolvedNavSlot[] {
  void caps; // reserved: grade / hasUpcomingExam gate no primary slot today.
  const [today, learn, practice, progress] = CORE_TABS;
  return [
    { ...today, id: 'today', kind: 'destination', altHrefs: ['/dashboard'], badge: 'streak' },
    { ...learn, id: 'learn', kind: 'destination', altHrefs: [] },
    { ...practice, id: 'practice', kind: 'destination', altHrefs: ['/quiz'] },
    { ...progress, id: 'progress', kind: 'destination', altHrefs: [] },
    MORE_SLOT,
  ];
}

/**
 * Pick the SINGLE href that owns the current pathname, longest match first.
 *
 * Guarantees at most one `aria-current="page"` per navigation surface, which a
 * per-item `isNavItemActive` loop cannot: on `/quiz` both `/quiz` and the
 * Practice slot's `/quiz` alt would otherwise light up, and on `/learn/math/1`
 * a future `/learn/math` entry would tie with `/learn`.
 */
export function resolveActiveNavHref(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!href) continue;
    if (!isNavItemActive(pathname, href)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

/** The one primary slot that owns `pathname`, or null when none does. */
export function resolvePrimaryActiveId(
  pathname: string,
  slots: readonly ResolvedNavSlot[],
): StudentNavSlotId | null {
  let best: { id: StudentNavSlotId; len: number } | null = null;
  for (const slot of slots) {
    const candidates = slot.href ? [slot.href, ...slot.altHrefs] : slot.altHrefs;
    const match = resolveActiveNavHref(pathname, candidates);
    if (match === null) continue;
    if (best === null || match.length > best.len) best = { id: slot.id, len: match.length };
  }
  return best?.id ?? null;
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
