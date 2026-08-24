/**
 * GROUPED SECONDARY NAVIGATION — the RENDERED flag gate (ff_nav_groups_v1).
 *
 * ── Why this is a component test and not more config assertions ──────────
 * `student-primary-nav-contract.test.ts` pins the same feature at the DATA
 * layer: membership, cross-tier mirroring, the /quiz and /simulations
 * exclusions, and that `isItemVisibleForFlags()` drops every gated row in
 * every flag-off state. All of that stays true even if a projection forgets
 * to CALL the filter, or renders a section header outside the
 * `items.length > 0` guard. Three separate components implement the
 * empty-group skip independently:
 *
 *   NavMoreSheet    `if (items.length) groupedMoreItems.push({ header, … })`
 *   DesktopSidebar  `.filter(section => section.items.length > 0)`
 *   TabletNavRail   `.filter(group => group.items.length > 0)` + the
 *                   `excludeGroupKeys` hand-off to the sheet it opens
 *
 * An orphan header — a section title that expands onto nothing — is a
 * rendering defect that no config assertion can see. That is the whole
 * property being shipped here: the flag is seeded OFF, so "OFF is
 * byte-for-byte the Phase 3 IA" is the claim the rollout rests on.
 *
 * The geometry (which tier is VISIBLE at which width) is CSS and is pinned in
 * `e2e/ui-nav-contract.spec.ts`. Nothing here duplicates that.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerPush = vi.fn();
/** Mutated per-test; every mock below reads it lazily, at render time. */
let mockFlags: Record<string, boolean> | null | undefined = {};
let mockPathname = '/dashboard';
let mockIsHi = false;

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    isHi: mockIsHi,
    roles: ['student'],
    activeRole: 'student',
    setActiveRole: vi.fn(),
    // `paid` suppresses the upgrade pill and a single role suppresses the
    // role switcher, so the sheet under test contains navigation only.
    student: { id: 'student-1', grade: '9', subscription_plan: 'paid' },
    snapshot: { current_streak: 0 },
  }),
}));

vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => ({ data: mockFlags }),
  useDashboardData: () => ({ data: {} }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        limit: () => chain,
        then: (resolve: (value: { data: unknown[] }) => void) => {
          resolve({ data: [] });
          return Promise.resolve();
        },
      };
      return chain;
    },
  },
}));

import { NavMoreSheet } from '@alfanumrik/ui/navigation/NavMoreSheet';
import { DesktopSidebar } from '@alfanumrik/ui/navigation/DesktopSidebar';
import { TabletNavRail } from '@alfanumrik/ui/navigation/TabletNavRail';
import {
  MORE_ITEMS,
  NAV_GROUPS_FLAG,
  NAV_GROUP_FLYOUT_KEYS,
} from '@alfanumrik/ui/navigation/nav-config';

/** The eight shipped rows, by the label a student actually reads. */
const PRACTICE_LABELS = ['PYQ Practice', 'Revision Center', 'Assignments', 'My Exams'] as const;
const EXPLORE_LABELS = ['Subjects', 'Curiosity Dive', 'Monthly Synthesis', 'NCERT Library'] as const;
const ALL_GROUP_LABELS = [...PRACTICE_LABELS, ...EXPLORE_LABELS];

/** Section/header copy that must not appear while the flag is off. */
const GROUP_HEADINGS = ['Practice & Tests', 'Explore'] as const;

/** Rows that predate the feature — they must be unaffected in both states. */
const PRE_EXISTING_SHEET_LABELS = ['Reminders', 'Leaderboard', 'STEM Lab', 'Profile'] as const;

/**
 * Flag-off states a real session actually passes through. `undefined` is the
 * pre-hydration value of `useFeatureFlags().data`, so a projection that reads
 * "not loaded" as "on" would FLASH eight unreleased destinations on first
 * paint and then remove them — visible to every student, on every cold load.
 */
const OFF_STATES: Array<[name: string, flags: Record<string, boolean> | null | undefined]> = [
  ['flags not loaded yet (undefined)', undefined],
  ['flags null', null],
  ['empty flag map', {}],
  ['flag explicitly false', { [NAV_GROUPS_FLAG]: false }],
  ['other flags on, this one absent', { ff_me_v2: true, ff_practice_os_v1: true }],
];

const ON_STATE: Record<string, boolean> = { [NAV_GROUPS_FLAG]: true };

beforeEach(() => {
  routerPush.mockClear();
  mockFlags = {};
  mockPathname = '/dashboard';
  mockIsHi = false;
});

afterEach(cleanup);

function renderSheet() {
  return render(
    <NavMoreSheet open onClose={() => {}} pathname={mockPathname} />,
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tier 1 — the More sheet (< 768px)
   ───────────────────────────────────────────────────────────────────────── */

describe('NavMoreSheet — grouped nav self-hides with the flag off', () => {
  for (const [name, flags] of OFF_STATES) {
    it(`renders no grouped row and no orphan header when ${name}`, () => {
      mockFlags = flags;
      renderSheet();
      const sheet = screen.getByRole('dialog', { name: 'More navigation options' });

      for (const label of ALL_GROUP_LABELS) {
        expect(
          within(sheet).queryByText(label),
          `"${label}" is a flag-gated grouped-nav row but rendered with ${name}`,
        ).toBeNull();
      }
      for (const heading of GROUP_HEADINGS) {
        expect(
          within(sheet).queryByText(heading),
          `the "${heading}" header rendered with ${name} even though every row under it ` +
            'was filtered out — an orphan section header that expands onto nothing',
        ).toBeNull();
      }
      // The Phase 3 IA is untouched: the sheet is what it always was.
      for (const label of PRE_EXISTING_SHEET_LABELS) {
        expect(
          within(sheet).queryByText(label),
          `"${label}" predates this feature and disappeared with ${name}`,
        ).not.toBeNull();
      }
    });
  }

  it('renders both headers and all eight rows once the flag is ON', () => {
    mockFlags = ON_STATE;
    renderSheet();
    const sheet = screen.getByRole('dialog', { name: 'More navigation options' });

    for (const heading of GROUP_HEADINGS) {
      expect(within(sheet).queryByText(heading), `"${heading}" header`).not.toBeNull();
    }
    for (const label of ALL_GROUP_LABELS) {
      expect(within(sheet).queryByText(label), `"${label}" row`).not.toBeNull();
    }
  });

  it('renders the Hindi copy for the new rows and headers under isHi (P7)', () => {
    mockFlags = ON_STATE;
    mockIsHi = true;
    renderSheet();
    const sheet = screen.getByRole('dialog', { name: 'More navigation options' });

    // Header + one row per group. English must not leak through.
    expect(within(sheet).queryByText('अभ्यास और परीक्षा'), 'practice header in Hindi').not.toBeNull();
    expect(within(sheet).queryByText('खोजें'), 'explore header in Hindi').not.toBeNull();
    expect(within(sheet).queryByText('पिछले साल के प्रश्न'), '/pyq in Hindi').not.toBeNull();
    expect(within(sheet).queryByText('NCERT पुस्तकालय'), '/library in Hindi').not.toBeNull();
    for (const heading of GROUP_HEADINGS) {
      expect(within(sheet).queryByText(heading), `English "${heading}" leaked under isHi`).toBeNull();
    }
    expect(within(sheet).queryByText('PYQ Practice'), 'English row leaked under isHi').toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Tier 3 — the desktop sidebar (1024px+)
   ───────────────────────────────────────────────────────────────────────── */

describe('DesktopSidebar — grouped sections drop out entirely with the flag off', () => {
  for (const [name, flags] of OFF_STATES) {
    it(`renders neither gated section when ${name}`, () => {
      mockFlags = flags;
      render(<DesktopSidebar />);
      const nav = screen.getByRole('navigation', { name: 'Main navigation' });

      for (const heading of GROUP_HEADINGS) {
        expect(
          within(nav).queryByText(heading),
          `the "${heading}" sidebar section header rendered with ${name}; the zero-item ` +
            'skip should have dropped the whole section',
        ).toBeNull();
      }
      for (const label of ALL_GROUP_LABELS) {
        expect(within(nav).queryByText(label), `"${label}" rendered with ${name}`).toBeNull();
      }
      // Pre-existing sections are untouched.
      for (const heading of ['Main', 'Study', 'Utilities', 'Account']) {
        expect(
          within(nav).queryByText(heading),
          `pre-existing section "${heading}" vanished with ${name}`,
        ).not.toBeNull();
      }
    });
  }

  it('renders both sections COLLAPSED with the flag on, and expands to the four rows', () => {
    mockFlags = ON_STATE;
    render(<DesktopSidebar />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });

    for (const [heading, labels] of [
      ['Practice & Tests', PRACTICE_LABELS],
      ['Explore', EXPLORE_LABELS],
    ] as const) {
      const header = within(nav).getByRole('button', { name: new RegExp(heading) });
      // Collapsed by default (DEFAULT_COLLAPSED_SECTIONS): turning the flag on
      // must not turn the sidebar into a wall of twenty links on first paint.
      expect(header.getAttribute('aria-expanded'), `"${heading}" starts collapsed`).toBe('false');
      for (const label of labels) {
        expect(within(nav).queryByText(label), `"${label}" hidden while collapsed`).toBeNull();
      }

      fireEvent.click(header);
      expect(header.getAttribute('aria-expanded'), `"${heading}" after click`).toBe('true');
      for (const label of labels) {
        expect(within(nav).queryByText(label), `"${label}" after expanding "${heading}"`).not.toBeNull();
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Tier 2 — the tablet rail (768–1023px)
   ───────────────────────────────────────────────────────────────────────── */

describe('TabletNavRail — flyouts appear only with the flag on, and never double-list a route', () => {
  for (const [name, flags] of OFF_STATES) {
    it(`renders no flyout trigger when ${name}`, () => {
      mockFlags = flags;
      const { container } = render(<TabletNavRail />);
      expect(
        container.querySelectorAll('[data-nav-group]').length,
        `a grouped-nav flyout trigger rendered with ${name}`,
      ).toBe(0);
      // The primary five are unaffected in every flag state.
      expect(container.querySelectorAll('[data-slot]').length).toBe(5);
    });
  }

  it('renders one flyout trigger per group with the flag on', () => {
    mockFlags = ON_STATE;
    const { container } = render(<TabletNavRail />);
    const triggers = [...container.querySelectorAll('[data-nav-group]')];
    expect(triggers.map((t) => t.getAttribute('data-nav-group'))).toEqual([
      ...NAV_GROUP_FLYOUT_KEYS,
    ]);
    // Menu buttons, not destinations: they open a panel, so they must never
    // claim the current-page marker the way a primary slot does.
    for (const trigger of triggers) {
      expect(trigger.getAttribute('aria-haspopup'), 'flyout trigger is a menu button').toBe('menu');
      expect(trigger.getAttribute('aria-current'), 'a flyout trigger must not be aria-current').toBeNull();
      expect(container.querySelectorAll('[data-slot]').length).toBe(5);
    }
  });

  it('opens a flyout containing exactly that group, and keeps those rows OUT of the sheet', () => {
    mockFlags = ON_STATE;
    const { container } = render(<TabletNavRail />);

    // 1. The flyout carries the group's own rows — icon AND label, in order.
    //    Derived from MORE_ITEMS rather than restated, so this pins that the
    //    rail PASSES the config through to <Menu> (a rail that dropped `icon`
    //    would render a label-only row that no config assertion can see),
    //    without forking a second copy of the icon list that could drift from
    //    the one student-primary-nav-contract.test.ts already pins.
    const expectedPracticeRows = MORE_ITEMS.filter(
      (row) => (row as { group?: string }).group === 'practice',
    ).map((row) => {
      const r = row as { icon: string; label: string; href: string };
      return `${r.icon}${r.label}`;
    });
    expect(expectedPracticeRows, 'fixture sanity: the practice group has four rows').toHaveLength(4);

    const practiceTrigger = container.querySelector('[data-nav-group="practice"]') as HTMLElement;
    fireEvent.click(practiceTrigger);
    const menu = screen.getByRole('menu');
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent?.trim()),
      'the rail flyout must render the same rows, icons and order as the config',
    ).toEqual(expectedPracticeRows);

    // 2. THE IA-LAW-1 PROPERTY. The rail passes `excludeGroupKeys` to the sheet
    //    it opens, so a route in a flyout is NOT also a sheet row at this
    //    breakpoint. Without that, /pyq is reachable twice at 800px.
    fireEvent.keyDown(document, { key: 'Escape' });
    const moreSlot = container.querySelector('[data-slot="more"]') as HTMLElement;
    fireEvent.click(moreSlot);
    const sheet = screen.getByRole('dialog', { name: 'More navigation options' });
    for (const label of ALL_GROUP_LABELS) {
      expect(
        within(sheet).queryByText(label),
        `"${label}" is in a rail flyout AND in the sheet the rail opens — one destination ` +
          'reachable twice at the same breakpoint',
      ).toBeNull();
    }
    for (const heading of GROUP_HEADINGS) {
      expect(
        within(sheet).queryByText(heading),
        `the "${heading}" header rendered in the rail's sheet even though the rail excludes ` +
          'that group',
      ).toBeNull();
    }
    // The ungrouped/other rows are still there — the exclusion is surgical.
    for (const label of PRE_EXISTING_SHEET_LABELS) {
      expect(within(sheet).queryByText(label), `"${label}" should stay in the rail's sheet`).not.toBeNull();
    }
  });
});
