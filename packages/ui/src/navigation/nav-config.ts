import { type UserRole } from '@alfanumrik/lib/AuthContext';
import { ROLE_CONFIG } from '@alfanumrik/lib/constants';

// ─── The student primary navigation (2026-08-09, revised 2026-08-24) ───────
//
// FIVE primary slots, one fixed order, identical labels + destinations + order
// at EVERY breakpoint. Only the PRESENTATION changes across tiers:
//
//   360–767px   → five-item bottom bar          (MobileBottomNav)
//   768–1023px  → vertical navigation rail      (TabletNavRail)
//   1024px+     → persistent sidebar            (DesktopSidebar)
//
//   1. Today  2. Practice  3. Foxy  4. Progress  5. More
//
// `Learn` was slot 2 until the 2026-08-19 Today consolidation. /today does that
// job now; the /learn route still resolves and is still deep-linked to from
// introduce_new_topic / revise actions — it simply owns no slot.
//
// CORE_TABS is the primary DESTINATIONS; "More" is the last slot and is an
// overflow control, not a destination, so it carries no href and is supplied
// by resolveStudentPrimaryNav() below. Consumers that need all slots in order
// (all three tier components do) must call resolveStudentPrimaryNav() rather
// than reading CORE_TABS directly.
//
// ═══ IA REVERSAL — Foxy is a PRIMARY DESTINATION again (2026-08-24) ═══
//
// CEO-DIRECTED, explicitly overriding the 2026-08-09 decision recorded below.
// The CEO defect report reads verbatim: "Foxy shall be in the main Menu in
// mobile view and students chat history shall be recorded and displayed to
// student." That is the authority for this reversal — do NOT "re-fix" it back
// to a utility on the strength of the 2026-08-09 rationale, which is retained
// immediately below only as history.
//
//   SUPERSEDED (2026-08-09): "Foxy left the primary bar. It previously
//   occupied slot 3 as a raised centre FAB. Per the navigation spec, Foxy /
//   profile / notifications / search are UTILITIES, not primary destinations,
//   so `/foxy` moved into the More sheet's 'Utilities' group (its first entry)
//   and into the desktop sidebar's new 'Utilities' section. `/practice` took
//   the vacated primary slot."
//
// What changed on 2026-08-24:
//   - `/foxy` is CORE_TABS slot 3 — the CENTRE of a five-slot bar, the same
//     position it held as the pre-2026-08-09 centre FAB (thumb-reachable, and
//     it restores the muscle memory that IA change broke). It is a plain slot,
//     NOT a raised FAB: the FAB chrome is what made it read as an unranked
//     affordance rather than a destination.
//   - No primary destination was displaced. Today / Practice / Progress all
//     keep their slots; the bar goes 4 → 5. This is inside the geometry the
//     bottom-bar CSS was already written for — globals.css
//     `.bottom-nav-mobile__slot` documents "five slots share the row evenly
//     and can never fall under the tap floor: 5 x 44 = 220px, which fits the
//     360px baseline viewport with ~140px to spare".
//   - `/foxy` is REMOVED from MORE_ITEMS and moved out of SIDEBAR_SECTIONS'
//     "Utilities" section into "Main", because a primary slot that is ALSO an
//     overflow row is the one-destination-two-places violation the IA law
//     below forbids (and which student-primary-nav-contract.test.ts pins).
//   - `/foxy` no longer suppresses the MOBILE bottom bar. It still suppresses
//     the tablet rail and desktop sidebar (both self-suppress; see
//     GlobalAppLayout). A primary destination that hides the bar the moment
//     you reach it is a trap: pre-reversal the ONLY exit from /foxy was the
//     header back arrow.
//
// IA law "one destination = one name = one icon" (2026-08-05). `/progress` was
// "Me" 🙂 here and "My Progress" 📈 in SIDEBAR_SECTIONS — one route wearing two
// names and two icons across viewports, and colliding with the `/me` and
// `/profile` entries below. It is now "Progress" 📈 in BOTH lists. No route
// changed; the labels/icons did.
//
// SLOT IDENTITY LIVES HERE (2026-08-19). Each tab carries its own slot `id`,
// `altHrefs` and optional `badge`. resolveStudentPrimaryNav() maps over this
// list instead of destructuring it positionally, and STUDENT_PRIMARY_ORDER is
// derived from it. Removing or reordering a tab is therefore a ONE-line edit
// that cannot silently shift the bar — which is exactly what happened when
// `/learn` was deleted from this array while the resolver still destructured
// four names out of it: every later slot shifted up one and the last spread
// `undefined`, rendering a blank, hrefless nav button to students.
export const CORE_TABS = [
  { id: 'today', href: '/today', icon: '☀️', activeIcon: '☀️', label: 'Today', labelHi: 'आज', altHrefs: ['/dashboard'], badge: 'streak' },
  // Slot 2 — see PRACTICE FLAG CONTRACT in resolveStudentPrimaryNav().
  { id: 'practice', href: '/practice', icon: '⚡', activeIcon: '⚡', label: 'Practice', labelHi: 'अभ्यास', altHrefs: ['/quiz'] },
  // Slot 3 — CEO-directed IA reversal, 2026-08-24. See the block above.
  // Centre of the five-slot bar. `/memory` is deliberately NOT an altHref:
  // it is its own named More-sheet destination ("What Foxy remembers") and
  // giving it to this slot would light Foxy current on a route the student
  // reached from somewhere else.
  { id: 'foxy', href: '/foxy', icon: '🦊', activeIcon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी', altHrefs: [] },
  { id: 'progress', href: '/progress', icon: '📈', activeIcon: '📈', label: 'Progress', labelHi: 'प्रगति', altHrefs: [] },
] as const;

/**
 * The single launch flag for the grouped secondary navigation (2026-08-24,
 * CEO-directed). Declared ABOVE MORE_ITEMS on purpose — `const` is in the TDZ
 * until its initialiser runs, and MORE_ITEMS references it at module-eval
 * time, so declaring it lower down would throw on import.
 *
 * ONE flag for the whole feature. Every added row in MORE_ITEMS and every
 * added section in SIDEBAR_SECTIONS carries it, so a single OFF value makes
 * the entire change invisible at all three breakpoints (empty groups are
 * skipped by NavMoreSheet and empty sections by DesktopSidebar) rather than
 * leaving half a projection behind.
 *
 * The flag ROW is architect-owned — registry entry `NAV_GROUPS_FLAGS.V1` in
 * packages/lib/src/flags/registries/consumer.ts, default OFF in
 * flags/defaults.ts, seeded OFF/0% by
 * 20260824120000_seed_ff_nav_groups_v1.sql. This module only names it, as a
 * string literal, matching how every other nav row states its flag
 * (`flagName: 'ff_me_v2'`) and what nav-config's own tests assert against. If
 * the registry ever renames the flag, this literal must move with it.
 */
export const NAV_GROUPS_FLAG = 'ff_nav_groups_v1';

/**
 * Group keys the TABLET rail projects as anchored `Menu` flyouts instead of
 * rows inside the More sheet. Same membership, same labels, same order — only
 * the control differs (IA law 2 constrains the ITEMS, not the chrome). The
 * rail is ~72px wide, so a dropdown beats a full-width sheet section there.
 *
 * TabletNavRail also EXCLUDES these keys from the sheet it opens, because a
 * row that is reachable from both the flyout and the sheet at the same
 * breakpoint is the one-destination-two-places violation (IA law 1).
 */
export const NAV_GROUP_FLYOUT_KEYS: readonly string[] = ['practice', 'explore'];

// ─── PHASE 3 IA TRIM (2026-08-10) ──────────────────────────────────────────
//
// MORE_ITEMS carried 18 rows and SIDEBAR_SECTIONS 22 links. The primary
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
  // `/foxy` is NOT listed here — it is primary slot 3 as of the 2026-08-24
  // CEO-directed IA reversal (see the block at the top of this file). It led
  // the "utilities" group from 2026-08-09 until then. Re-adding it would put
  // one destination in two places at the same breakpoint, which the IA law
  // below forbids and which student-primary-nav-contract.test.ts fails on.
  // Was "Settings & Notifications" — wrong on both halves. The page carries no
  // settings controls, and the job the IA gives this destination is reminders.
  { href: '/notifications', icon: '🔔', label: 'Reminders', labelHi: 'रिमाइंडर', group: 'utilities' },
  // Foxy North-Star Phase 1 — learner-memory transparency + erasure screen.
  { href: '/memory', icon: '🦊', label: 'What Foxy remembers', labelHi: 'फॉक्सी क्या याद रखता है', group: 'utilities' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड', group: 'study' },
  { href: '/stem-centre', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब', group: 'study' },
  // /practice is NOT listed here — it is primary slot 2. See the PRACTICE FLAG
  // CONTRACT note on resolveStudentPrimaryNav().

  // ─── GROUPED SECONDARY NAV (ff_nav_groups_v1, 2026-08-24) ───────────────
  //
  // CEO-directed. The Phase 3 IA trim above records nine live student routes
  // that were deliberately left with ZERO navigation affordance — reachable
  // only from notifications, teacher links and Foxy deep links. Re-surfaced
  // here as two GROUPS rather than nine loose rows, so the overflow does not
  // go back to being the flat, unranked second product surface the trim
  // removed. Every row below carries `flagName: NAV_GROUPS_FLAG`, so with the
  // flag OFF isItemVisibleForFlags() drops all of them, both groups go empty,
  // and NavMoreSheet's empty-group skip means not even a header renders — the
  // whole feature self-hides and the Phase 3 IA is byte-for-byte intact.
  //
  // WHAT IS DELIBERATELY ABSENT, and why (IA law: one destination = one name
  // = one icon, one place per breakpoint):
  //   /quiz        — the Practice primary slot's altHref (PRACTICE FLAG
  //                  CONTRACT). A row here as well would be the exact
  //                  two-places-one-route violation this file keeps recording.
  //   /simulations — NOT a destination. It is a legacy alias that does
  //                  `router.replace('/stem-centre')`
  //                  (apps/host/src/app/(student)/simulations/page.tsx), and
  //                  /stem-centre is already the row named "STEM Lab" 🔬 in
  //                  the Study group directly above. Listing both would put
  //                  one destination under two names at one breakpoint — the
  //                  same defect as the old "Home"/"Dashboard" pair.
  //   /mock-exam   — does not exist. Mock exams live at
  //                  /exams/mock/[paperId], which is why the group links
  //                  /exams (the "My Exams" hub) instead.
  //   /exam-briefing, /exam-prep, /refresh — still un-surfaced. Out of scope
  //                  for this change; they remain deep-link-only.
  //
  // Labels are each screen's OWN name, not an invented one, so the nav and
  // the page agree (e.g. /pyq's own h1 is "PYQ Practice" / "पिछले साल के
  // प्रश्न", /revision's is "Revision Center" / "दोहराव केंद्र").

  // Practice & Tests — the practice surfaces that own no primary slot.
  { href: '/pyq', icon: '📄', label: 'PYQ Practice', labelHi: 'पिछले साल के प्रश्न', flagName: NAV_GROUPS_FLAG, group: 'practice' },
  // /revision 404s (notFound()) when ff_revision_os_v1 is OFF. That flag has
  // been enabled globally at 100% since migration 20260722104300 and was
  // explicitly left ON by 20260802110000, so this row leads somewhere for
  // every student today. If ff_revision_os_v1 is ever rolled back, ROLL THIS
  // ROW BACK WITH IT — a nav row that 404s is worse than no row.
  { href: '/revision', icon: '🔁', label: 'Revision Center', labelHi: 'दोहराव केंद्र', flagName: NAV_GROUPS_FLAG, group: 'practice' },
  { href: '/assignments', icon: '📝', label: 'Assignments', labelHi: 'असाइनमेंट', flagName: NAV_GROUPS_FLAG, group: 'practice' },
  { href: '/exams', icon: '🗓️', label: 'My Exams', labelHi: 'मेरी परीक्षाएँ', flagName: NAV_GROUPS_FLAG, group: 'practice' },

  // Explore — the browse/discovery surfaces. /dive and /synthesis are
  // Pedagogy v2 surfaces that render an explanatory "not available yet" panel
  // WITH a way back when their own flags are off (they never 404), so they are
  // safe nav rows in every flag state.
  { href: '/learn', icon: '📚', label: 'Subjects', labelHi: 'विषय', flagName: NAV_GROUPS_FLAG, group: 'explore' },
  { href: '/dive', icon: '🌊', label: 'Curiosity Dive', labelHi: 'जिज्ञासा डाइव', flagName: NAV_GROUPS_FLAG, group: 'explore' },
  { href: '/synthesis', icon: '🧩', label: 'Monthly Synthesis', labelHi: 'मासिक सारांश', flagName: NAV_GROUPS_FLAG, group: 'explore' },
  { href: '/library', icon: '📖', label: 'NCERT Library', labelHi: 'NCERT पुस्तकालय', flagName: NAV_GROUPS_FLAG, group: 'explore' },

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
export const MORE_SHEET_GROUPS: {
  key: string;
  en: string;
  hi: string;
  /** Rail-flyout glyph. Rendered only by the tablet projection; the More
   *  sheet's headers stay text-only, exactly as they were. */
  icon?: string;
}[] = [
  // Utilities first — reminders and the memory screen are the things a
  // student reaches for mid-session. Foxy itself left this group on
  // 2026-08-24 (CEO-directed IA reversal) and is now primary slot 3; the
  // group still has two members, so the header still renders.
  { key: 'utilities', en: 'Utilities', hi: 'उपयोगिताएँ' },
  { key: 'study', en: 'Study', hi: 'पढ़ाई' },
  // ─── "practice" RESTORED WITH MEMBERS (2026-08-24, CEO-directed) ───────
  //
  // SUPERSEDES the note that stood here from the 2026-08-10 Phase 3 trim,
  // which read: "The 'Practice' group is GONE. It held the practice surfaces
  // that did not get a primary slot — /assignments, /pyq, /mock-exam,
  // /exam-briefing, /exam-prep — all of which left the nav, so the key had no
  // member left and NavMoreSheet (which skips empty groups) would never have
  // rendered the header again. Leaving a key that can match nothing is
  // indistinguishable from one that has nothing to match YET, so it is
  // removed rather than kept as dead config."
  //
  // That reasoning was right and is why the key was removed rather than left
  // dead. It is re-added now for the opposite reason: it HAS members again —
  // /pyq, /revision, /assignments, /exams, all four flag-gated on
  // NAV_GROUPS_FLAG in MORE_ITEMS above. The empty-group skip still holds, so
  // with the flag OFF this key matches nothing and no header renders, exactly
  // as if it were still absent.
  //
  // The DISPLAY name is "Practice & Tests", not "Practice", deliberately:
  // "Practice" ⚡ is primary slot 2 (/practice). A group header wearing the
  // same word as a primary slot is two things called Practice at one
  // breakpoint — a name collision of the same family as the "Me"/"My
  // Progress" and "Home"/"Dashboard" ones this file records. The KEY stays
  // 'practice' because it is the group's identity, not its label.
  { key: 'practice', en: 'Practice & Tests', hi: 'अभ्यास और परीक्षा', icon: '🎯' },
  // Explore — the browse/discovery surfaces (/learn, /dive, /synthesis,
  // /library). Net-new key, net-new members; same NAV_GROUPS_FLAG gate.
  { key: 'explore', en: 'Explore', hi: 'खोजें', icon: '🧭' },
  // Account stays last in BOTH projections.
  { key: 'account', en: 'Account', hi: 'खाता' },
];

// The desktop projection of the SAME trimmed set as MORE_ITEMS: the primary
// destinations in the Main section, then the identical Utilities / Study /
// Account membership the More sheet renders. Item-for-item mirroring is the
// point — a student who resizes from 360px to 1440px must not discover a
// different product. The only structural difference is that the sidebar shows
// the primaries inline (the phone tiers render them as the bar itself).
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
      { href: '/practice', icon: '⚡', label: 'Practice', labelHi: 'अभ्यास' },
      // 2026-08-24 — moved UP from the "Utilities" section below when the
      // CEO-directed IA reversal made `/foxy` primary slot 3. Item-for-item
      // mirroring of CORE_TABS is the IA law this file keeps recording: a
      // student who resizes from 360px to 1440px must not discover a
      // different product, and a primary destination filed under "Utilities"
      // on desktop is exactly that.
      { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी' },
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
      { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड' },
      { href: '/stem-centre', icon: '🔬', label: 'STEM Lab',    labelHi: 'STEM लैब' },
    ],
  },
  {
    // ─── MIRROR of the More sheet's "practice" group (2026-08-24) ────────
    //
    // Item-for-item, label-for-label, icon-for-icon, in the same order. That
    // mirroring IS the point: a student who resizes from 360px to 1440px must
    // not discover a different product (IA law 2). Every item carries the same
    // NAV_GROUPS_FLAG as its More-sheet twin, so this section empties out
    // wholesale with the flag OFF; DesktopSidebar drops zero-item sections so
    // no orphan header renders.
    //
    // Title matches the group's display name, NOT the key — see the collision
    // note on MORE_SHEET_GROUPS ("Practice" is primary slot 2).
    title: 'Practice & Tests', titleHi: 'अभ्यास और परीक्षा',
    items: [
      { href: '/pyq', icon: '📄', label: 'PYQ Practice', labelHi: 'पिछले साल के प्रश्न', flagName: NAV_GROUPS_FLAG },
      { href: '/revision', icon: '🔁', label: 'Revision Center', labelHi: 'दोहराव केंद्र', flagName: NAV_GROUPS_FLAG },
      { href: '/assignments', icon: '📝', label: 'Assignments', labelHi: 'असाइनमेंट', flagName: NAV_GROUPS_FLAG },
      { href: '/exams', icon: '🗓️', label: 'My Exams', labelHi: 'मेरी परीक्षाएँ', flagName: NAV_GROUPS_FLAG },
    ],
  },
  {
    // Mirror of the More sheet's "explore" group — same four destinations,
    // same names, same icons, same order.
    title: 'Explore', titleHi: 'खोजें',
    items: [
      { href: '/learn', icon: '📚', label: 'Subjects', labelHi: 'विषय', flagName: NAV_GROUPS_FLAG },
      { href: '/dive', icon: '🌊', label: 'Curiosity Dive', labelHi: 'जिज्ञासा डाइव', flagName: NAV_GROUPS_FLAG },
      { href: '/synthesis', icon: '🧩', label: 'Monthly Synthesis', labelHi: 'मासिक सारांश', flagName: NAV_GROUPS_FLAG },
      { href: '/library', icon: '📖', label: 'NCERT Library', labelHi: 'NCERT पुस्तकालय', flagName: NAV_GROUPS_FLAG },
    ],
  },
  {
    // 2026-08-09 — new section for the non-destination affordances the spec
    // calls utilities, mirroring the More sheet's "Utilities" group so both
    // projections carry the same mental model.
    //
    // 2026-08-24 — `/foxy` LEFT this section for "Main" (CEO-directed IA
    // reversal; it is primary slot 3 now). The section keeps two members, so
    // it still renders. Do not move Foxy back here.
    title: 'Utilities', titleHi: 'उपयोगिताएँ',
    items: [
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

export type StudentNavSlotId = (typeof CORE_TABS)[number]['id'] | 'more';

/** The order is a product contract, not a rendering detail. Derived from
 *  CORE_TABS so the declared order and the rendered order cannot disagree. */
export const STUDENT_PRIMARY_ORDER: readonly StudentNavSlotId[] = [
  ...CORE_TABS.map((t) => t.id),
  'more',
];

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
 * The primary slots for the student role, in the fixed spec order.
 *
 * PRACTICE FLAG CONTRACT (`ff_practice_os_v1`)
 * --------------------------------------------
 * The Practice SLOT is permanent — the bar is five items in every flag state,
 * never three. The flag governs what `/practice` RENDERS, not whether the slot
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
 * be graduated to satisfy the destination contract. `altHrefs: ['/quiz']`
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
  return [
    ...CORE_TABS.map((tab): ResolvedNavSlot => ({
      id: tab.id,
      kind: 'destination',
      href: tab.href,
      icon: tab.icon,
      activeIcon: tab.activeIcon,
      label: tab.label,
      labelHi: tab.labelHi,
      altHrefs: [...tab.altHrefs],
      ...('badge' in tab ? { badge: tab.badge } : {}),
    })),
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

/**
 * The shape every role's primary tab list projects to. Student tabs carry
 * extra slot metadata (`id` / `altHrefs` / `badge`); the teacher and guardian
 * projections do not. Declared explicitly rather than inferred: an inferred
 * union of two different array shapes makes the `.map()` parameter `never` at
 * the MobileBottomNav / TabletNavRail call sites.
 */
export interface CoreTab {
  href: string;
  icon: string;
  activeIcon: string;
  label: string;
  labelHi: string;
}

export function getCoreTabs(role: UserRole): CoreTab[] {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, activeIcon: n.icon, label: n.label, labelHi: n.labelHi }));
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, activeIcon: n.icon, label: n.label, labelHi: n.labelHi }));
  }
  return [...CORE_TABS];
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
