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
  MORE_SHEET_GROUPS,
  NAV_GROUP_FLYOUT_KEYS,
  NAV_GROUPS_FLAG,
  SIDEBAR_SECTIONS,
  STUDENT_PRIMARY_ORDER,
  STUDENT_MORE_SLOT,
  isItemVisibleForFlags,
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

/* ═══════════════════════════════════════════════════════════════════════════
   GROUPED SECONDARY NAVIGATION — ff_nav_groups_v1 (2026-08-24, CEO-directed)

   Eight live student routes that the 2026-08-10 Phase 3 IA trim deliberately
   left with ZERO navigation affordance are re-surfaced as TWO GROUPS behind a
   single flag, seeded OFF. Three projections render the same membership:

     < 768px    NavMoreSheet   → inline sections, empty groups skipped
     768–1023   TabletNavRail  → anchored Menu flyouts (and the sheet EXCLUDES
                                 those group keys, so no route is reachable
                                 twice at one breakpoint)
     1024px+    DesktopSidebar → collapsed-by-default disclosure sections,
                                 zero-item sections dropped

   Everything below is a property of the RESOLVED CONFIG, which is what all
   three projections read. The rendered counterparts (a flag-off render
   producing no orphan header, the rail's flyout chrome) are pinned separately
   in `nav-groups-flag-gating.test.tsx`; the two layers stay disjoint, exactly
   as this file's header describes.
   ═══════════════════════════════════════════════════════════════════════════ */

const NAV_GROUP_KEYS = ['practice', 'explore'] as const;
type NavGroupKey = (typeof NAV_GROUP_KEYS)[number];

/**
 * SHIPPED MEMBERSHIP, restated as a product constant rather than derived from
 * the config — deriving it would make this file agree with any edit, which is
 * the opposite of a contract. Adding a ninth row, dropping one, or reordering
 * a group is a deliberate product change and must show up here as a red test.
 *
 * Two absences are load-bearing and are asserted separately below:
 *   /simulations — a `router.replace('/stem-centre')` redirect, and
 *                  /stem-centre is already the Study group's "STEM Lab" row.
 *   /quiz        — the Practice primary slot's altHref.
 */
const NAV_GROUP_MEMBERSHIP: Record<NavGroupKey, readonly string[]> = {
  practice: ['/pyq', '/revision', '/assignments', '/exams'],
  explore: ['/learn', '/dive', '/synthesis', '/library'],
};

const ALL_GROUP_HREFS: readonly string[] = [
  ...NAV_GROUP_MEMBERSHIP.practice,
  ...NAV_GROUP_MEMBERSHIP.explore,
];

/** Group KEY → the display name both the sheet header and the sidebar section
 *  title must carry. "Practice & Tests", not "Practice": the bare word is
 *  primary slot 2, and two things called Practice at one breakpoint is the
 *  name collision nav-config keeps recording. */
const NAV_GROUP_TITLES: Record<NavGroupKey, string> = {
  practice: 'Practice & Tests',
  explore: 'Explore',
};

/** These row shapes are heterogeneous unions in the config (only some entries
 *  carry `flagName` / `group`), so read them through narrow accessors — the
 *  same shape the components themselves use. */
const flagOf = (row: unknown): string | undefined =>
  (row as { flagName?: string } | undefined)?.flagName;
const groupOf = (row: unknown): string | undefined =>
  (row as { group?: string } | undefined)?.group;

interface NavRowLike {
  href: string;
  icon: string;
  label: string;
  labelHi: string;
}

const moreRowsIn = (key: string): NavRowLike[] =>
  MORE_ITEMS.filter((row) => groupOf(row) === key) as NavRowLike[];

const sidebarSectionTitled = (title: string) =>
  SIDEBAR_SECTIONS.find((s) => s.title === title);

/**
 * Flag states in which the ENTIRE feature must be invisible. `undefined` and
 * `null` are the real pre-hydration states of `useFeatureFlags().data`, not
 * hypotheticals — a projection that treats "not loaded yet" as "on" would
 * flash eight unreleased destinations on first paint.
 */
const NAV_GROUPS_OFF_STATES: Array<{
  name: string;
  flags: Record<string, boolean> | null | undefined;
}> = [
  { name: 'flags not yet loaded (undefined)', flags: undefined },
  { name: 'flags explicitly null', flags: null },
  { name: 'empty flag map', flags: {} },
  { name: 'ff_nav_groups_v1 explicitly false', flags: { [NAV_GROUPS_FLAG]: false } },
  {
    name: 'every OTHER launch flag ON but this one absent',
    flags: {
      ff_me_v2: true,
      ff_practice_os_v1: true,
      ff_today_home_v1: true,
      ff_revision_os_v1: true,
    },
  },
];

const NAV_GROUPS_ON: Record<string, boolean> = { [NAV_GROUPS_FLAG]: true };

describe('grouped secondary nav — declared membership', () => {
  it('names the launch flag exactly once, as the registry spells it', () => {
    // The literal in nav-config must track NAV_GROUPS_FLAGS.V1 in
    // packages/lib/src/flags/registries/consumer.ts. A rename on one side only
    // makes every gated row permanently invisible with no error anywhere.
    expect(NAV_GROUPS_FLAG).toBe('ff_nav_groups_v1');
  });

  for (const key of NAV_GROUP_KEYS) {
    it(`the "${key}" More-sheet group holds exactly its declared rows, in order`, () => {
      const actual = moreRowsIn(key).map((r) => r.href);
      expect(
        actual,
        `MORE_ITEMS group "${key}" is [${actual.join(', ')}] but the shipped ` +
          `membership is [${NAV_GROUP_MEMBERSHIP[key].join(', ')}]`,
      ).toEqual([...NAV_GROUP_MEMBERSHIP[key]]);
    });
  }

  it('declares a header for every group key that has members, and vice versa', () => {
    const declaredKeys = MORE_SHEET_GROUPS.map((g) => g.key);
    for (const key of NAV_GROUP_KEYS) {
      expect(
        declaredKeys,
        `group key "${key}" has members in MORE_ITEMS but no MORE_SHEET_GROUPS ` +
          'header — NavMoreSheet iterates the HEADER list, so those rows would ' +
          'never render at any breakpoint',
      ).toContain(key);
    }
    // The converse: a header key that matches nothing is dead config that is
    // indistinguishable from one that has nothing to match YET. This is the
    // reason the 'practice' key was DELETED in the Phase 3 trim rather than
    // left behind; it is back only because it has members again.
    const orphanKeys = MORE_SHEET_GROUPS.filter(
      (g) => !MORE_ITEMS.some((row) => groupOf(row) === g.key),
    ).map((g) => g.key);
    expect(
      orphanKeys,
      `MORE_SHEET_GROUPS declares header(s) [${orphanKeys.join(', ')}] that no ` +
        'MORE_ITEMS row belongs to — dead config',
    ).toEqual([]);
  });

  it('gives the group headers the display names the IA requires', () => {
    for (const key of NAV_GROUP_KEYS) {
      const group = MORE_SHEET_GROUPS.find((g) => g.key === key);
      expect(group, `no MORE_SHEET_GROUPS entry for "${key}"`).toBeDefined();
      expect(
        group!.en,
        `group "${key}" header — "Practice" alone is primary slot 2's label, so ` +
          'the header must not wear the same word',
      ).toBe(NAV_GROUP_TITLES[key]);
    }
  });

  it('projects the two groups as tablet flyouts, and only those two', () => {
    // NAV_GROUP_FLYOUT_KEYS drives BOTH the rail's flyouts and the keys the
    // rail excludes from its own More sheet. A key listed here with no header
    // excludes nothing and renders nothing; a group MISSING here would be
    // reachable from the flyout AND the sheet at 800px (IA law 1).
    expect([...NAV_GROUP_FLYOUT_KEYS].sort()).toEqual([...NAV_GROUP_KEYS].sort());
    for (const key of NAV_GROUP_FLYOUT_KEYS) {
      const group = MORE_SHEET_GROUPS.find((g) => g.key === key);
      expect(group, `flyout key "${key}" has no MORE_SHEET_GROUPS header`).toBeDefined();
      // TabletNavRail falls back to a bare '▸' glyph when `icon` is absent —
      // a placeholder shipping to students as the only thing on a 72px rail.
      expect(
        (group!.icon ?? '').trim(),
        `flyout group "${key}" has no icon; the rail would render the '▸' ` +
          'placeholder as the trigger glyph',
      ).not.toBe('');
    }
  });
});

describe('grouped secondary nav — the sheet and the sidebar mirror item-for-item', () => {
  /**
   * THE CROSS-BREAKPOINT IA LAW. A student who resizes from 360px to 1440px
   * must not discover a different product. This is the same property the
   * existing primary-destination test asserts for CORE_TABS vs the sidebar,
   * extended to the two new groups — and it is the one that catches a row
   * added to only one of the two lists.
   */
  for (const key of NAV_GROUP_KEYS) {
    it(`"${key}" has the same rows, labels, icons and ORDER in the desktop sidebar`, () => {
      const title = NAV_GROUP_TITLES[key];
      const section = sidebarSectionTitled(title);
      expect(
        section,
        `SIDEBAR_SECTIONS has no section titled "${title}" — the ${key} group ` +
          'exists on mobile and vanishes at 1024px+',
      ).toBeDefined();

      const sheetRows = moreRowsIn(key);
      const sidebarRows = section!.items as NavRowLike[];

      expect(
        sidebarRows.map((r) => r.href),
        `"${title}" sidebar membership/order differs from the More sheet's`,
      ).toEqual(sheetRows.map((r) => r.href));

      for (const sheetRow of sheetRows) {
        const twin = sidebarRows.find((r) => r.href === sheetRow.href)!;
        expect(twin.label, `${sheetRow.href} label across tiers`).toBe(sheetRow.label);
        expect(twin.labelHi, `${sheetRow.href} Hindi label across tiers`).toBe(sheetRow.labelHi);
        expect(twin.icon, `${sheetRow.href} icon across tiers`).toBe(sheetRow.icon);
      }
    });

    it(`"${key}" carries the same bilingual section title in both projections`, () => {
      const group = MORE_SHEET_GROUPS.find((g) => g.key === key)!;
      const section = sidebarSectionTitled(NAV_GROUP_TITLES[key])!;
      expect(section.title).toBe(group.en);
      expect(section.titleHi, `"${key}" Hindi title across tiers`).toBe(group.hi);
    });
  }

  it('mirrors the flag gate item-for-item, so a group can never half-ship', () => {
    // If a sidebar twin were ungated, turning the flag off would empty the
    // sheet group while the sidebar still showed all four rows at 1024px+.
    for (const key of NAV_GROUP_KEYS) {
      const section = sidebarSectionTitled(NAV_GROUP_TITLES[key])!;
      for (const row of section.items) {
        expect(
          flagOf(row),
          `sidebar row ${(row as NavRowLike).href} in "${NAV_GROUP_TITLES[key]}" is ` +
            `gated on ${String(flagOf(row))}, not ${NAV_GROUPS_FLAG} — it would ` +
            'survive a flag-off rollout while its More-sheet twin disappeared',
        ).toBe(NAV_GROUPS_FLAG);
      }
    }
  });
});

describe('grouped secondary nav — one destination, one place', () => {
  it('never lists the same href in two groups', () => {
    const byHref = new Map<string, string[]>();
    for (const row of MORE_ITEMS) {
      const href = (row as NavRowLike).href;
      byHref.set(href, [...(byHref.get(href) ?? []), groupOf(row) ?? '(ungrouped)']);
    }
    const duplicated = [...byHref.entries()].filter(([, groups]) => groups.length > 1);
    expect(
      duplicated.map(([href, groups]) => `${href} → ${groups.join(' + ')}`),
      'these hrefs appear in more than one More-sheet group; the same route in ' +
        'two groups is one destination in two places at one breakpoint',
    ).toEqual([]);
  });

  it('never lists the same href in two sidebar sections', () => {
    const byHref = new Map<string, string[]>();
    for (const section of SIDEBAR_SECTIONS) {
      for (const row of section.items) {
        const href = (row as NavRowLike).href;
        byHref.set(href, [...(byHref.get(href) ?? []), section.title]);
      }
    }
    const duplicated = [...byHref.entries()].filter(([, titles]) => titles.length > 1);
    expect(
      duplicated.map(([href, titles]) => `${href} → ${titles.join(' + ')}`),
      'these hrefs appear in more than one sidebar section',
    ).toEqual([]);
  });

  /**
   * THE /quiz EXCLUSION, pinned. `/quiz` is the Practice slot's altHref: with
   * ff_practice_os_v1 OFF, /practice does `router.replace('/quiz')`. A group
   * row for /quiz would give one destination a primary slot AND an overflow
   * row at the same breakpoint — and `resolveActiveNavHref`'s longest-match
   * tie-break would then quietly hand the current-page marker to the group row
   * instead of the primary slot.
   */
  it('gives no group row a primary href or a primary altHref', () => {
    const primaries = resolveStudentPrimaryNav();
    const reserved = new Map<string, string>();
    for (const slot of primaries) {
      if (slot.href) reserved.set(slot.href, `${slot.id} slot href`);
      for (const alt of slot.altHrefs) reserved.set(alt, `${slot.id} slot altHref`);
    }

    const offenders = ALL_GROUP_HREFS.filter((href) => reserved.has(href)).map(
      (href) => `${href} (already the ${reserved.get(href)})`,
    );
    expect(
      offenders,
      `These grouped-nav rows collide with the primary bar: ${offenders.join('; ')}. ` +
        'A route that owns a primary slot must not ALSO be an overflow row — that is ' +
        'the one-destination-two-places violation, and it is why /quiz is excluded.',
    ).toEqual([]);

    // Stated positively so the intent survives a refactor of the loop above.
    expect(ALL_GROUP_HREFS, '/quiz is the Practice slot altHref').not.toContain('/quiz');
  });

  /**
   * `/simulations` is not a destination at all — it is
   * `router.replace('/stem-centre')` (apps/host/src/app/(student)/simulations/
   * page.tsx) and /stem-centre already ships as the Study group's "STEM Lab".
   * Listing both would put one destination under two names at one breakpoint,
   * the same defect as the retired "Home"/"Dashboard" pair.
   */
  it('lists the redirect alias /simulations nowhere in the navigation', () => {
    const everyHref = [
      ...MORE_ITEMS.map((r) => (r as NavRowLike).href),
      ...SIDEBAR_SECTIONS.flatMap((s) => s.items.map((r) => (r as NavRowLike).href)),
    ];
    expect(
      everyHref.filter((h) => h === '/simulations'),
      '/simulations redirects to /stem-centre, which is already the "STEM Lab" row — ' +
        'listing it too is one destination under two names',
    ).toEqual([]);
    expect(everyHref, '/stem-centre is the real destination and must stay listed').toContain(
      '/stem-centre',
    );
  });
});

describe('grouped secondary nav — every new row is bilingual and gated (P7)', () => {
  for (const key of NAV_GROUP_KEYS) {
    for (const href of NAV_GROUP_MEMBERSHIP[key]) {
      it(`${href} carries a real Devanagari labelHi and a non-empty label/icon`, () => {
        const row = moreRowsIn(key).find((r) => r.href === href);
        expect(row, `${href} is missing from the "${key}" group`).toBeDefined();
        expect(row!.label.trim(), `${href} English label`).not.toBe('');
        expect(row!.icon.trim(), `${href} icon`).not.toBe('');
        expect(row!.labelHi.trim(), `${href} Hindi label`).not.toBe('');
        // Same Devanagari check the primary slots get: an untranslated English
        // copy sitting in labelHi passes a non-empty check and fails a student.
        expect(
          row!.labelHi,
          `${href} labelHi is "${row!.labelHi}" — it carries no Devanagari, so it is ` +
            'not a translation',
        ).toMatch(/[ऀ-ॿ]/);
      });

      it(`${href} is gated on ${NAV_GROUPS_FLAG} — nothing ships ungated by accident`, () => {
        const row = MORE_ITEMS.find((r) => (r as NavRowLike).href === href);
        expect(
          flagOf(row),
          `${href} is gated on ${String(flagOf(row))}. Every grouped-nav row must carry ` +
            `${NAV_GROUPS_FLAG}; an ungated one ships to students the moment it merges, ` +
            'regardless of the rollout.',
        ).toBe(NAV_GROUPS_FLAG);
      });
    }
  }

  it('gives both group headers a Devanagari Hindi title', () => {
    for (const key of NAV_GROUP_KEYS) {
      const group = MORE_SHEET_GROUPS.find((g) => g.key === key)!;
      expect(group.en.trim(), `"${key}" English header`).not.toBe('');
      expect(group.hi, `"${key}" Hindi header is "${group.hi}" — no Devanagari`).toMatch(
        /[ऀ-ॿ]/,
      );
      const section = sidebarSectionTitled(NAV_GROUP_TITLES[key])!;
      expect(section.titleHi, `"${key}" sidebar Hindi title`).toMatch(/[ऀ-ॿ]/);
    }
  });
});

describe('grouped secondary nav — group routes light NO primary slot', () => {
  const slots: ResolvedNavSlot[] = resolveStudentPrimaryNav();

  // All eight, not just the four named in the brief: any of them lighting a
  // primary slot means the bar claims a route it does not own, and the student
  // sees the wrong tab highlighted for the whole visit.
  for (const href of ALL_GROUP_HREFS) {
    it(`resolvePrimaryActiveId is null on ${href}`, () => {
      expect(
        resolvePrimaryActiveId(href, slots),
        `${href} is a grouped-nav destination — it must light the "More" overflow, ` +
          'not a primary slot',
      ).toBeNull();
    });
  }

  it('stays null on descendants of the group routes', () => {
    // Segment-boundary matching (isNavItemActive) is what keeps `/practice`
    // from claiming `/pyq/2024` and `/me` from claiming `/memory`.
    for (const href of ALL_GROUP_HREFS) {
      expect(resolvePrimaryActiveId(`${href}/some/child`, slots), `${href}/some/child`).toBeNull();
    }
  });
});

describe('grouped secondary nav — the flag-OFF self-hide', () => {
  /**
   * THE SAFETY PROPERTY THAT MAKES SHIPPING OFF MEANINGFUL.
   *
   * `isItemVisibleForFlags` is the single filter all three projections apply
   * (NavMoreSheet via useMoreSheetItems, TabletNavRail via the same hook,
   * DesktopSidebar inline). If it lets one row through in a flag-off state,
   * an unreleased destination ships to every student.
   */
  for (const { name, flags } of NAV_GROUPS_OFF_STATES) {
    it(`filters out every grouped-nav row when ${name}`, () => {
      const survivors = MORE_ITEMS.filter((row) => isItemVisibleForFlags(row, flags))
        .map((row) => (row as NavRowLike).href)
        .filter((href) => ALL_GROUP_HREFS.includes(href));
      expect(
        survivors,
        `these grouped-nav rows survived the flag-off filter (${name}): ${survivors.join(', ')}`,
      ).toEqual([]);

      const sidebarSurvivors = SIDEBAR_SECTIONS.flatMap((s) =>
        s.items.filter((row) => isItemVisibleForFlags(row, flags)),
      )
        .map((row) => (row as NavRowLike).href)
        .filter((href) => ALL_GROUP_HREFS.includes(href));
      expect(
        sidebarSurvivors,
        `these grouped-nav sidebar rows survived the flag-off filter (${name}): ` +
          sidebarSurvivors.join(', '),
      ).toEqual([]);
    });

    it(`leaves no orphan group header or empty sidebar section when ${name}`, () => {
      // NavMoreSheet: `if (items.length) groupedMoreItems.push({ header, items })`
      // — a group whose rows all filtered out contributes no header at all.
      const visible = MORE_ITEMS.filter((row) => isItemVisibleForFlags(row, flags));
      const headersThatWouldRender = MORE_SHEET_GROUPS.filter((g) =>
        visible.some((row) => groupOf(row) === g.key),
      ).map((g) => g.key);
      for (const key of NAV_GROUP_KEYS) {
        expect(
          headersThatWouldRender,
          `the "${key}" header would render with ${name} even though it has zero visible ` +
            'rows — an orphan section header',
        ).not.toContain(key);
      }

      // DesktopSidebar: `.filter(section => section.items.length > 0)` — the
      // two gated sections must drop out entirely.
      const sectionsThatWouldRender = SIDEBAR_SECTIONS.map((s) => ({
        title: s.title,
        items: s.items.filter((row) => isItemVisibleForFlags(row, flags)),
      })).filter((s) => s.items.length > 0);
      for (const key of NAV_GROUP_KEYS) {
        expect(
          sectionsThatWouldRender.map((s) => s.title),
          `the "${NAV_GROUP_TITLES[key]}" sidebar section would render with ${name} ` +
            'even though every row is filtered out',
        ).not.toContain(NAV_GROUP_TITLES[key]);
      }

      // …and NOTHING ELSE drops out. The empty-skip branch is only supposed to
      // be reachable by the flag-gated sections; if a pre-existing section ever
      // empties, the flag-off sidebar silently loses a section that has nothing
      // to do with this feature.
      const preExisting = SIDEBAR_SECTIONS.map((s) => s.title).filter(
        (t) => t !== NAV_GROUP_TITLES.practice && t !== NAV_GROUP_TITLES.explore,
      );
      expect(
        sectionsThatWouldRender.map((s) => s.title),
        `a pre-existing sidebar section vanished with ${name}; the flag-off sidebar must ` +
          'be byte-for-byte the Phase 3 IA',
      ).toEqual(preExisting);
    });
  }

  it('surfaces all eight rows in both projections once the flag is ON', () => {
    // The other half of the gate: an over-eager filter that hid the rows even
    // when the flag ramped would look identical to a correct flag-off state.
    const sheetVisible = MORE_ITEMS.filter((row) => isItemVisibleForFlags(row, NAV_GROUPS_ON)).map(
      (row) => (row as NavRowLike).href,
    );
    for (const href of ALL_GROUP_HREFS) {
      expect(sheetVisible, `${href} did not appear in the More sheet with the flag ON`).toContain(
        href,
      );
    }

    for (const key of NAV_GROUP_KEYS) {
      const section = sidebarSectionTitled(NAV_GROUP_TITLES[key])!;
      const visible = section.items
        .filter((row) => isItemVisibleForFlags(row, NAV_GROUPS_ON))
        .map((row) => (row as NavRowLike).href);
      expect(visible, `"${NAV_GROUP_TITLES[key]}" with the flag ON`).toEqual([
        ...NAV_GROUP_MEMBERSHIP[key],
      ]);
    }
  });

  it('leaves the primary bar untouched in every grouped-nav flag state', () => {
    // The feature is additive by construction. If turning it on could move a
    // primary slot, "ship OFF" would stop being a safe rollout.
    for (const { name, flags } of [...NAV_GROUPS_OFF_STATES, { name: 'flag ON', flags: NAV_GROUPS_ON }]) {
      expect(
        resolveStudentPrimaryNav({ flags }).map((s) => s.id),
        `primary slots with ${name}`,
      ).toEqual([...EXPECTED_ORDER]);
    }
  });
});
