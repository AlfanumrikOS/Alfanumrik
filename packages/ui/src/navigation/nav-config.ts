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

// ─── PHASE 3 IA TRIM (2026-08-10) ──────────────────────────────────────────
//
// MORE_ITEMS carried 18 rows and SIDEBAR_SECTIONS 22 links. The five primary
// slots were right, but the breadth BELOW them meant a student met ~20 named
// places one tap past the bar — the overflow had become a second, unranked
// product surface. Trimmed to 10 More rows / 14 sidebar links, and the two
// projections now mirror each other item-for-item.
//
// ROUTES ARE RETAINED, ONLY NAV ENTRIES WERE REMOVED. Nine destinations left
// the navigation and every one of them still resolves and is still deep-linked
// to from outside the nav — removing the page would break those callers:
//
//   /assignments, /pyq, /mock-exam, /exam-briefing, /refresh, /revision,
//   /exam-prep   — targets of ~24 notification types, teacher assignment links
//                  and Foxy deep links.
//   /quiz        — reached through the Practice slot (PRACTICE FLAG CONTRACT
//                  below: /practice replaces to /quiz while ff_practice_os_v1
//                  is OFF, and `altHrefs: ['/quiz']` keeps the slot current).
//   /dashboard   — the Today slot's real landing page while ff_today_home_v1
//                  is OFF (TODAY FLAG CONTRACT below).
//
// DUPLICATE HOME REMOVED. `/dashboard` was a More row called "Home" AND the
// Today slot's `altHrefs` target, so the app shipped two names for one home.
// The row is gone; the altHrefs behaviour is deliberately unchanged, because
// it is what keeps exactly one slot `aria-current` while the Today routing
// flag settles.
export const MORE_ITEMS = [
  // 2026-08-09 — Foxy is a UTILITY, not a primary destination. It used to be
  // the raised centre FAB in CORE_TABS; the navigation spec reserves the five
  // primary slots for Today / Learn / Practice / Progress / More and classes
  // Foxy alongside profile, notifications and search. It leads the utilities
  // group so it stays one interaction away on phones.
  { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी', group: 'utilities' },
  // Was "Settings & Notifications" — wrong on both halves. The page carries no
  // settings controls, and the job the IA gives this destination is reminders.
  { href: '/notifications', icon: '🔔', label: 'Reminders', labelHi: 'रिमाइंडर', group: 'utilities' },
  // Foxy North-Star Phase 1 — learner-memory transparency + erasure screen.
  { href: '/memory', icon: '🦊', label: 'What Foxy remembers', labelHi: 'फॉक्सी क्या याद रखता है', group: 'utilities' },
  { href: '/library', icon: '📚', label: 'Library', labelHi: 'अध्ययन सामग्री', group: 'study' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड', group: 'study' },
  { href: '/stem-centre', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब', group: 'study' },
  // /practice is NOT listed here — it is primary slot 3. See the PRACTICE FLAG
  // CONTRACT note on resolveStudentPrimaryNav().
  { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल', group: 'account' },
  // Wave B gap screen 16 "Me" — flag-gated (ff_me_v2). Additive presentation
  // layer over /profile (apps/host/src/app/me/page.tsx); only appears once
  // the launch flag is ON.
  // Label was "Me (New)" — a build-status marker leaking into student-facing
  // UI, and one of the THREE things called "Me" (the others were the /progress
  // tab and /profile). With /progress renamed to "Progress", plain "Me" is now
  // unambiguous and is the screen's real name.
  { href: '/me', icon: '⚙️', label: 'Me', labelHi: 'मैं', flagName: 'ff_me_v2', group: 'account' },
  { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट', group: 'account' },
  { href: '/support', icon: '📨', label: 'My Tickets', labelHi: 'मेरे टिकट', group: 'account' },
];

/** More-sheet section headers (mobile overflow projection only). `group` on a
 *  MORE_ITEMS entry references these. Ungrouped items render at the top, then
 *  groups in this order. Mirrors SIDEBAR_SECTIONS' Utilities/Study/Account
 *  sections so both projections share the same mental model (IA law). */
export const MORE_SHEET_GROUPS: { key: string; en: string; hi: string }[] = [
  // Utilities first — Foxy, reminders and the memory screen are the things a
  // student reaches for mid-session, and Foxy in particular lost its
  // centre-FAB slot when the five primary destinations were fixed.
  { key: 'utilities', en: 'Utilities', hi: 'उपयोगिताएँ' },
  { key: 'study', en: 'Study', hi: 'पढ़ाई' },
  { key: 'account', en: 'Account', hi: 'खाता' },
  // The "Practice" group is GONE (Phase 3 trim). It held the practice surfaces
  // that did not get a primary slot — /assignments, /pyq, /mock-exam,
  // /exam-briefing, /exam-prep — all of which left the nav, so the key had no
  // member left and NavMoreSheet (which skips empty groups) would never have
  // rendered the header again. Leaving a key that can match nothing is
  // indistinguishable from one that has nothing to match YET, so it is removed
  // rather than kept as dead config.
];

// The desktop projection of the SAME trimmed set as MORE_ITEMS: four primary
// destinations in the Main section, then the identical Utilities / Study /
// Account membership the More sheet renders. Item-for-item mirroring is the
// point — a student who resizes from 360px to 1440px must not discover a
// different product. The only structural difference is that the sidebar shows
// the four primaries inline (the phone tiers render them as the bar itself).
export const SIDEBAR_SECTIONS = [
  {
    // 2026-08-09 — was titled "Home" while also containing an item called
    // "Home". Retitled "Main"; the "Home" (/dashboard) row was removed in the
    // Phase 3 trim, because /dashboard is already the Today slot's landing
    // page while ff_today_home_v1 is OFF and two names for one home is the
    // exact IA-law violation this file keeps recording.
    //
    // `/learn` was previously ABSENT from the sidebar entirely: a primary
    // destination that existed at 360px and vanished at 1024px. Added 2026-08-09.
    //
    // `/today` carries NO flagName. It used to, which was safe only while the
    // "Home" row sat beside it; with that row gone, a flag-gated Today would
    // leave the 1024px+ sidebar with three destinations and no home whenever
    // ff_today_home_v1 is off or has not loaded yet — a fourth-destination
    // dropout the other two tiers never had (CORE_TABS never gated Today).
    // Un-gating is safe and NOT a new route behaviour: /today with the flag
    // OFF does `router.replace('/dashboard')` (apps/host/src/app/today/page.tsx),
    // so it is a redirect, never a dead end. See TODAY FLAG CONTRACT below.
    title: 'Main', titleHi: 'मुख्य',
    items: [
      { href: '/today', icon: '☀️', label: 'Today', labelHi: 'आज' },
      { href: '/learn', icon: '📚', label: 'Learn', labelHi: 'सीखें' },
      { href: '/practice', icon: '⚡', label: 'Practice', labelHi: 'अभ्यास' },
      // Matches CORE_TABS exactly — same name, same icon, same route.
      { href: '/progress', icon: '📈', label: 'Progress', labelHi: 'प्रगति' },
    ],
  },
  {
    // The "Practice" SECTION is gone (Phase 3 trim): /quiz, /assignments,
    // /pyq, /mock-exam and /exam-briefing all left the nav. /quiz in
    // particular is now reached through the primary Practice slot, whose
    // altHrefs include it — listing it here as well was the one place a
    // surface carried both, and the reason resolveActiveNavHref needs its
    // longest-match tie-break. That resolver is unchanged and still needed:
    // /learn vs a future /learn/* entry has the same shape.
    title: 'Study', titleHi: 'पढ़ाई',
    items: [
      { href: '/library',     icon: '📚', label: 'Library',     labelHi: 'अध्ययन सामग्री' },
      // /leaderboard was in the More sheet but in NO sidebar section — an
      // overflow destination that simply did not exist at 1024px+. Mirrored in.
      { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड' },
      { href: '/stem-centre', icon: '🔬', label: 'STEM Lab',    labelHi: 'STEM लैब' },
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
      // Same relabel as MORE_ITEMS — the page has no settings controls and the
      // IA names this job reminders.
      { href: '/notifications', icon: '🔔', label: 'Reminders', labelHi: 'रिमाइंडर' },
      // Foxy North-Star Phase 1 — learner-memory transparency + erasure screen.
      { href: '/memory', icon: '🦊', label: 'What Foxy remembers', labelHi: 'फॉक्सी क्या याद रखता है' },
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
