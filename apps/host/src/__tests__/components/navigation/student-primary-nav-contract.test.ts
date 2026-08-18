/**
 * THE STUDENT PRIMARY NAVIGATION CONTRACT (commit 3, 2026-08-09).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * `resolveStudentPrimaryNav()` is now the single source for the navigation
 * rendered by ALL THREE tier components (MobileBottomNav < 768,
 * TabletNavRail 768–1023, DesktopSidebar 1024+). The product contract it
 * encodes — five slots, one fixed order, the same destinations at every
 * breakpoint — had NO test at all when it landed. Every property below could
 * be broken by a one-line edit to nav-config.ts and nothing in the suite
 * would have gone red:
 *
 *   - dropping a slot (four-item bar)
 *   - reordering (Practice before Learn)
 *   - giving the overflow slot an href (a "More" that navigates)
 *   - re-listing a primary destination inside the More sheet (the exact
 *     duplication the 2026-08-05 IA law "one destination = one name = one
 *     icon" was written to stop, and which nav-config's own comments record
 *     as having happened twice already)
 *   - a flag state that collapses the bar to four slots (the PRACTICE FLAG
 *     CONTRACT explicitly forbids this)
 *
 * ── Why these are unit tests and not browser tests ───────────────────────
 * Every assertion here is about the RESOLVED DATA, not about layout. It is
 * a pure function over a config object, so a browser adds cost and nothing
 * else. The properties that genuinely need a browser — which tier is
 * visible at which width, exactly one `aria-current="page"` in the rendered
 * accessibility tree, the five slots fitting at 360px — are pinned in
 * `e2e/ui-nav-contract.spec.ts`. The two layers are deliberately disjoint.
 */
import { describe, it, expect } from 'vitest';
import {
  CORE_TABS,
  MORE_ITEMS,
  SIDEBAR_SECTIONS,
  STUDENT_PRIMARY_ORDER,
  STUDENT_MORE_SLOT,
  resolveStudentPrimaryNav,
  resolvePrimaryActiveId,
  resolveActiveNavHref,
  type ResolvedNavSlot,
} from '@alfanumrik/ui/navigation/nav-config';

/** The product order, restated here so a change to the export is a failure. */
const EXPECTED_ORDER = ['today', 'learn', 'practice', 'progress', 'more'] as const;

/** The four primary DESTINATIONS (the fifth slot is overflow, not a route). */
const EXPECTED_HREFS = ['/today', '/learn', '/practice', '/progress'] as const;

/**
 * Flag states the bar must survive identically. The PRACTICE FLAG CONTRACT
 * (nav-config.ts) says the flag governs what `/practice` RENDERS, never
 * whether the slot exists — so all of these must produce the same five slots.
 */
const FLAG_STATES: Array<{ name: string; flags: Record<string, boolean> | null | undefined }> = [
  { name: 'flags not yet loaded (undefined)', flags: undefined },
  { name: 'flags explicitly null', flags: null },
  { name: 'all launch flags OFF', flags: {} },
  {
    name: 'all launch flags ON',
    flags: {
      ff_practice_os_v1: true,
      ff_today_home_v1: true,
      ff_revision_os_v1: true,
      ff_test_os_v1: true,
      ff_me_v2: true,
    },
  },
  {
    name: 'practice + today OFF explicitly (the collapse-risk state)',
    flags: { ff_practice_os_v1: false, ff_today_home_v1: false },
  },
];

describe('student primary nav — the five-slot contract', () => {
  it('exports the order as a five-entry product constant', () => {
    expect(STUDENT_PRIMARY_ORDER).toEqual(EXPECTED_ORDER);
  });

  it('resolves exactly five slots, in the declared order, in every flag state', () => {
    for (const { name, flags } of FLAG_STATES) {
      const slots = resolveStudentPrimaryNav({ flags });
      expect(slots.map((s) => s.id), `slot order with ${name}`).toEqual([...EXPECTED_ORDER]);
      expect(slots, `slot COUNT with ${name} — the bar is five items in every flag state, never four`)
        .toHaveLength(5);
    }
  });

  it('keeps the same five slots across every grade and exam state', () => {
    // grade/hasUpcomingExam gate More-sheet items, never a primary slot.
    for (const grade of [6, 7, 8, 9, 10, 11, 12]) {
      for (const hasUpcomingExam of [true, false]) {
        const slots = resolveStudentPrimaryNav({ grade, hasUpcomingExam });
        expect(
          slots.map((s) => s.id),
          `grade=${grade} hasUpcomingExam=${hasUpcomingExam}`,
        ).toEqual([...EXPECTED_ORDER]);
      }
    }
  });

  it('routes the first four slots to the declared destinations', () => {
    const slots = resolveStudentPrimaryNav();
    expect(slots.slice(0, 4).map((s) => s.href)).toEqual([...EXPECTED_HREFS]);
    for (const slot of slots.slice(0, 4)) {
      expect(slot.kind, `${slot.id} must be a destination`).toBe('destination');
    }
  });

  it('keeps the fifth slot an overflow control with no destination', () => {
    const slots = resolveStudentPrimaryNav();
    const more = slots[4];
    expect(more.id).toBe('more');
    expect(more.kind).toBe('overflow');
    // A "More" with an href is a More that navigates — a different product.
    expect(more.href, 'the overflow slot must carry no href').toBeNull();
    expect(more).toBe(STUDENT_MORE_SLOT);
  });

  it('gives every slot a non-empty bilingual label and icon (P7)', () => {
    for (const slot of resolveStudentPrimaryNav()) {
      expect(slot.label.trim(), `${slot.id} English label`).not.toBe('');
      expect(slot.labelHi.trim(), `${slot.id} Hindi label`).not.toBe('');
      // Hindi labels must actually be Devanagari, not an untranslated copy of
      // the English string sitting in the labelHi field.
      expect(
        slot.labelHi,
        `${slot.id} labelHi is "${slot.labelHi}" — it carries no Devanagari, so it is not a translation`,
      ).toMatch(/[ऀ-ॿ]/);
      expect(slot.icon.trim(), `${slot.id} icon`).not.toBe('');
      expect(slot.activeIcon.trim(), `${slot.id} activeIcon`).not.toBe('');
    }
  });

  it('gives the overflow slot a screen-reader name that says it opens a sheet', () => {
    // The visible label is the short "More"; the accessible name must say what
    // the control does, because it does not navigate. Both languages.
    expect(STUDENT_MORE_SLOT.a11yLabel).toBe('More options');
    expect(STUDENT_MORE_SLOT.a11yLabelHi).toMatch(/[ऀ-ॿ]/);
  });
});

describe('student primary nav — the primaries are never ALSO in the More sheet', () => {
  /**
   * The IA law recorded in nav-config.ts: one destination = one name = one
   * icon. A primary destination that is also a More-sheet row is the same
   * route in two places at the same breakpoint — the failure mode that put
   * `/progress` in the app under two names ("Me" and "My Progress") and
   * `/dashboard` under two ("Dashboard" and "Home").
   */
  it('lists none of the four primary destinations inside MORE_ITEMS', () => {
    const moreHrefs = MORE_ITEMS.map((i) => i.href);
    const leaked = EXPECTED_HREFS.filter((href) => moreHrefs.includes(href));
    expect(
      leaked,
      `These primary destinations are ALSO rows in the More sheet: ${leaked.join(', ')}. ` +
        'A primary slot and an overflow row for the same route puts one destination in two ' +
        'places at the same breakpoint.',
    ).toEqual([]);
  });

  it('keeps CORE_TABS and the resolved primaries in sync', () => {
    // resolveStudentPrimaryNav destructures CORE_TABS positionally, so a
    // reorder of CORE_TABS silently reorders the bar. Pin both.
    expect(CORE_TABS.map((t) => t.href)).toEqual([...EXPECTED_HREFS]);
    expect(CORE_TABS).toHaveLength(4);
  });

  it('gives every primary destination the same label and icon in the desktop sidebar', () => {
    // The sidebar is the 1024+ projection of the SAME five slots. A student who
    // resizes must not meet a different name for the same route.
    const sidebarItems = SIDEBAR_SECTIONS.flatMap((s) => s.items);
    for (const slot of resolveStudentPrimaryNav().slice(0, 4)) {
      const match = sidebarItems.find((i) => i.href === slot.href);
      expect(match, `${slot.href} is a primary destination but is absent from the desktop sidebar`)
        .toBeDefined();
      expect(match!.label, `${slot.href} label across tiers`).toBe(slot.label);
      expect(match!.icon, `${slot.href} icon across tiers`).toBe(slot.icon);
      expect(match!.labelHi, `${slot.href} Hindi label across tiers`).toBe(slot.labelHi);
    }
  });
});

describe('student primary nav — exactly one slot is ever current', () => {
  const slots: ResolvedNavSlot[] = resolveStudentPrimaryNav();

  /**
   * `resolvePrimaryActiveId` returns a SINGLE id by construction, so the
   * meaningful assertion is not "it returns one" but "it returns the RIGHT
   * one, and never null on a route the student actually reaches". Zero
   * current slots is the defect nav-config's TODAY FLAG CONTRACT note records
   * as having been measured in Chromium at 360px before altHrefs was added.
   */
  const CASES: Array<[pathname: string, expected: string | null, why: string]> = [
    ['/today', 'today', 'exact primary destination'],
    ['/dashboard', 'today', 'TODAY FLAG CONTRACT: /today redirects here while ff_today_home_v1 is OFF'],
    ['/learn', 'learn', 'exact primary destination'],
    ['/learn/science/3', 'learn', 'descendant of a primary destination'],
    ['/practice', 'practice', 'exact primary destination'],
    ['/quiz', 'practice', 'PRACTICE FLAG CONTRACT: /practice redirects here while ff_practice_os_v1 is OFF'],
    ['/quiz/session/abc', 'practice', 'descendant of the practice alt destination'],
    ['/progress', 'progress', 'exact primary destination'],
    ['/progress/dashboard', 'progress', 'descendant of a primary destination'],
    // Overflow destinations own no primary slot — the bar highlights "More"
    // instead, which the tier components derive from a null primary id.
    ['/profile', null, 'a More-sheet destination must not light a primary slot'],
    ['/leaderboard', null, 'a More-sheet destination must not light a primary slot'],
    ['/foxy', null, 'Foxy is a utility, not a primary destination (2026-08-09 IA change)'],
  ];

  for (const [pathname, expected, why] of CASES) {
    it(`marks ${expected ?? 'no primary slot'} current on ${pathname} — ${why}`, () => {
      expect(resolvePrimaryActiveId(pathname, slots)).toBe(expected);
    });
  }

  it('never lets a shorter href steal a longer sibling route', () => {
    // The RCA W2 class of bug, restated at the resolver level: `/me` must not
    // win on `/memory`, and no primary slot may claim either.
    expect(resolvePrimaryActiveId('/memory', slots)).toBeNull();
    expect(resolvePrimaryActiveId('/mock-exam', slots)).toBeNull();
  });

  it('prefers the longest match when a surface lists both /practice and /quiz', () => {
    // The desktop sidebar lists /quiz in its own right AND carries the
    // Practice slot whose altHrefs include /quiz. Only one may be current.
    const winner = resolveActiveNavHref('/quiz', ['/practice', '/quiz']);
    expect(winner).toBe('/quiz');
  });

  it('returns null rather than guessing on a route no slot owns', () => {
    expect(resolvePrimaryActiveId('/some/unrouted/page', slots)).toBeNull();
  });
});
