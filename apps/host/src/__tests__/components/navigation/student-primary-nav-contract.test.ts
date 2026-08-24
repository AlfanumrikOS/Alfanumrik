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
 *   - reordering (Progress before Practice)
 *   - giving the overflow slot an href (a "More" that navigates)
 *   - re-listing a primary destination inside the More sheet (the exact
 *     duplication the 2026-08-05 IA law "one destination = one name = one
 *     icon" was written to stop, and which nav-config's own comments record
 *     as having happened twice already)
 *   - a flag state that collapses the bar to three slots (the PRACTICE FLAG
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

/** The product order, restated here so a change to the export is a failure.
 *
 *  `foxy` was added at slot 3 on 2026-08-24 by the CEO-directed IA reversal
 *  recorded at the top of nav-config.ts. It is deliberately restated here
 *  rather than derived: if someone "re-fixes" Foxy back into the More sheet on
 *  the strength of the superseded 2026-08-09 rationale, this constant is what
 *  makes that a red test instead of a silent regression. */
const EXPECTED_ORDER = ['today', 'practice', 'foxy', 'progress', 'more'] as const;

/** The four primary DESTINATIONS (the fifth slot is overflow, not a route).
 *  `/learn` left the bar in the 2026-08-19 Today consolidation; `/today` does
 *  that job now. The route itself still resolves and is still deep-linked to. */
const EXPECTED_HREFS = ['/today', '/practice', '/foxy', '/progress'] as const;

/** Count of primary DESTINATION slots (everything except the overflow). */
const PRIMARY_COUNT = EXPECTED_HREFS.length;

/**
 * Flag states the bar must survive identically. The PRACTICE FLAG CONTRACT
 * (nav-config.ts) says the flag governs what `/practice` RENDERS, never
 * whether the slot exists — so all of these must produce the same four slots.
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
        .toHaveLength(EXPECTED_ORDER.length);
    }
  });

  it('keeps the same four slots across every grade and exam state', () => {
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
    expect(slots.slice(0, PRIMARY_COUNT).map((s) => s.href)).toEqual([...EXPECTED_HREFS]);
    for (const slot of slots.slice(0, PRIMARY_COUNT)) {
      expect(slot.kind, `${slot.id} must be a destination`).toBe('destination');
    }
  });

  /**
   * THE BLANK-BUTTON GUARD, restated for the Foxy slot specifically.
   *
   * nav-config.ts records a real incident: `/learn` was deleted from CORE_TABS
   * while resolveStudentPrimaryNav() still destructured four names out of the
   * array, so every later slot shifted up one, the last spread `undefined`,
   * and students got a blank, hrefless nav button. Adding a slot is the same
   * class of edit as removing one. This asserts the NEW slot specifically
   * resolves with a real, non-empty href — not just that some slot does.
   */
  it('gives the Foxy slot a real, non-empty destination href', () => {
    for (const { name, flags } of FLAG_STATES) {
      const foxy = resolveStudentPrimaryNav({ flags }).find((s) => s.id === 'foxy');
      expect(foxy, `Foxy slot missing with ${name}`).toBeDefined();
      expect(foxy!.kind, `Foxy must be a destination with ${name}`).toBe('destination');
      expect(typeof foxy!.href, `Foxy href type with ${name}`).toBe('string');
      expect(foxy!.href, `Foxy href must be non-empty with ${name}`).toBeTruthy();
      expect(foxy!.href!.trim(), `Foxy href must not be whitespace with ${name}`).not.toBe('');
      expect(foxy!.href, `Foxy href with ${name}`).toBe('/foxy');
    }
  });

  it('keeps the last slot an overflow control with no destination', () => {
    const slots = resolveStudentPrimaryNav();
    const more = slots[slots.length - 1];
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
  it('lists none of the primary destinations inside MORE_ITEMS', () => {
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
    // resolveStudentPrimaryNav() now MAPS over CORE_TABS. It used to
    // destructure it positionally, which is how deleting /learn from the array
    // shifted every later slot and left the last one spreading `undefined`.
    // Pin the list anyway: the bar's destinations are a product contract.
    expect(CORE_TABS.map((t) => t.href)).toEqual([...EXPECTED_HREFS]);
    expect(CORE_TABS).toHaveLength(PRIMARY_COUNT);
  });

  it('never resolves a slot without an href, label or icon', () => {
    // The exact defect the positional destructure produced: a spread of
    // `undefined` yielded a blank, hrefless button in the student bottom bar.
    for (const slot of resolveStudentPrimaryNav()) {
      if (slot.kind === 'destination') {
        expect(slot.href, `${slot.id} destination href`).toBeTruthy();
      }
      expect(slot.label, `${slot.id} label`).toBeTruthy();
      expect(slot.icon, `${slot.id} icon`).toBeTruthy();
    }
  });

  it('gives every resolved slot the id its CORE_TABS entry declares', () => {
    // Slot id drives active-state highlighting. When the resolver mislabels a
    // tile (Practice carrying id 'today'), the wrong slot lights up.
    const primaries = resolveStudentPrimaryNav().filter((s) => s.kind === 'destination');
    expect(primaries.map((s) => s.id)).toEqual(CORE_TABS.map((t) => t.id));
  });

  it('gives every primary destination the same label and icon in the desktop sidebar', () => {
    // The sidebar is the 1024+ projection of the SAME four slots. A student who
    // resizes must not meet a different name for the same route.
    const sidebarItems = SIDEBAR_SECTIONS.flatMap((s) => s.items);
    for (const slot of resolveStudentPrimaryNav().slice(0, PRIMARY_COUNT)) {
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
    // /learn is no longer a primary destination (2026-08-19 Today
    // consolidation). The route still resolves; it just owns no slot.
    ['/learn', null, 'left the bar in the Today consolidation — owns no primary slot'],
    ['/learn/science/3', null, 'descendant of a route that owns no primary slot'],
    ['/practice', 'practice', 'exact primary destination'],
    ['/quiz', 'practice', 'PRACTICE FLAG CONTRACT: /practice redirects here while ff_practice_os_v1 is OFF'],
    ['/quiz/session/abc', 'practice', 'descendant of the practice alt destination'],
    ['/progress', 'progress', 'exact primary destination'],
    ['/progress/dashboard', 'progress', 'descendant of a primary destination'],
    // Overflow destinations own no primary slot — the bar highlights "More"
    // instead, which the tier components derive from a null primary id.
    ['/profile', null, 'a More-sheet destination must not light a primary slot'],
    ['/leaderboard', null, 'a More-sheet destination must not light a primary slot'],
    // 2026-08-24 CEO-directed IA reversal — Foxy is primary slot 3 again.
    // This case previously asserted `null` under the 2026-08-09 rationale.
    ['/foxy', 'foxy', 'Foxy is primary slot 3 (2026-08-24 CEO-directed IA reversal)'],
    ['/foxy/anything', 'foxy', 'descendant of the Foxy primary destination'],
    ['/memory', null, 'a More-sheet destination — the Foxy slot must NOT claim it'],
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
