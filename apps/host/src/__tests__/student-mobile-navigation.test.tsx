import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerPush = vi.fn();
const setActiveRole = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    isHi: false,
    roles: ['student', 'teacher'],
    activeRole: 'student',
    setActiveRole,
    student: { id: 'student-1', grade: '8', subscription_plan: 'paid' },
    snapshot: { current_streak: 4 },
  }),
}));

vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => ({ data: {} }),
  useDashboardData: () => ({ data: { due_count: 2 } }),
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

import { MobileBottomNav } from '@alfanumrik/ui/navigation/MobileBottomNav';
import {
  CORE_TABS,
  MORE_ITEMS,
  SIDEBAR_SECTIONS,
  resolvePrimaryActiveId,
  resolveStudentPrimaryNav,
} from '@alfanumrik/ui/navigation/nav-config';

describe('live student mobile navigation', () => {
  beforeEach(() => {
    routerPush.mockReset();
    setActiveRole.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps overflow destinations and verified role switching in the More sheet', async () => {
    render(<MobileBottomNav />);

    const moreTrigger = screen.getByRole('button', { name: 'More options' });
    fireEvent.click(moreTrigger);

    const dialog = screen.getByRole('dialog', { name: 'More navigation options' });
    expect(within(dialog).getByRole('button', { name: 'STEM Lab' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Profile' })).toBeInTheDocument();
    expect(within(dialog).getByText('Switch Role')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Teacher' }));
    expect(setActiveRole).toHaveBeenCalledWith('teacher');
    expect(routerPush).toHaveBeenCalledWith('/teacher');
  });

  it('groups the More sheet overflow into Utilities / Study / Account headers (2026-08-10 Phase 3 trim)', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const dialog = screen.getByRole('dialog', { name: 'More navigation options' });

    // UPDATED 2026-08-10 (Phase 3 IA trim). This test previously asserted an
    // ungrouped "Home" row (/dashboard) and a "Practice" header. Both are gone
    // by design, and asserting them would now pin the pre-trim IA:
    //   - the "Home" row was /dashboard under a SECOND name, while /dashboard
    //     is already the Today slot's landing page (altHrefs). One home, one
    //     name — so there is no ungrouped row left at all.
    //   - the "Practice" group's entire membership (/assignments, /pyq,
    //     /mock-exam, /exam-briefing, /exam-prep) left the nav, so the key was
    //     removed from MORE_SHEET_GROUPS rather than left unmatchable.
    // The INTENT — the sheet renders grouped section headers, not one flat
    // list, and membership survives the grouping — is unchanged and asserted
    // below against the three groups that exist now.
    expect(within(dialog).getByText('Utilities')).toBeInTheDocument();
    expect(within(dialog).getByText('Study')).toBeInTheDocument();
    expect(within(dialog).getByText('Account')).toBeInTheDocument();
    expect(within(dialog).queryByText('Practice')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();

    // Section membership is preserved — items render inside their group, not lost.
    // UPDATED 2026-08-24 (CEO-directed IA reversal). This line used to assert a
    // "Foxy" row here. `/foxy` is primary slot 3 now and was removed from
    // MORE_ITEMS; a row here as well would be one destination in two places at
    // the same breakpoint. "Reminders" is the Utilities group's first member
    // now and stands in for the same INTENT — items land inside their group.
    expect(within(dialog).getByRole('button', { name: 'Reminders' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'STEM Lab' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Profile' })).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Foxy' }),
      'Foxy is a primary slot now — a More-sheet row for it as well is the ' +
        'one-destination-two-places violation the IA law forbids',
    ).not.toBeInTheDocument();
  });

  it('keeps the More sheet overflow scrollable so every item stays reachable on short viewports', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const dialog = screen.getByRole('dialog', { name: 'More navigation options' });
    const content = dialog.querySelector('[class*="max-h-"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain('overflow-y-auto');
  });

  it('routes the live quiz destination to the working quiz experience', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const dialog = screen.getByRole('dialog', { name: 'More navigation options' });
    expect(within(dialog).queryByRole('button', { name: 'Practice' })).not.toBeInTheDocument();

    // UPDATED 2026-08-10 (Phase 3 IA trim). This used to assert a single
    // sidebar row for /quiz labelled "Quiz". The Phase 3 trim removed that row:
    // /quiz is now reached through the PRIMARY Practice slot, whose altHrefs
    // carry it, so a separate sidebar entry was the same destination in two
    // places at 1024px+.
    //
    // The guarded property is unchanged and is asserted more directly than
    // before: the live quiz engine is still a reachable nav destination and
    // the nav still marks the student's position when they are on it. What is
    // NO LONGER asserted — the label string "Quiz" on a row that no longer
    // exists — is dropped rather than weakened.
    const quizItems = SIDEBAR_SECTIONS.flatMap((section) => section.items).filter(
      (item) => item.href === '/quiz',
    );
    expect(
      quizItems,
      '/quiz is reached through the Practice primary slot; a sidebar row for it as well puts one ' +
        'destination in two places at the same breakpoint',
    ).toHaveLength(0);

    const practiceSlot = resolveStudentPrimaryNav().find((s) => s.id === 'practice');
    expect(practiceSlot?.altHrefs, 'the Practice slot is what keeps /quiz reachable').toContain('/quiz');
    expect(resolvePrimaryActiveId('/quiz', resolveStudentPrimaryNav())).toBe('practice');
  });

  it('gives every sidebar entry a distinct name within its section (en + hi)', () => {
    // IA law "one destination = one name". The Practice section previously read
    // "Practice > Practice Center / Practice" — the same word three times
    // meaning three things. Hindi is asserted too so a rename cannot fix the
    // English collision while leaving the Hindi one (P7).
    //
    // NOTE (superseded 2026-08-10): the "Home" section used to contain an item
    // also called "Home" (/dashboard), which was excused here as a section
    // title matching its own landing item. The Phase 3 IA trim removed that
    // row outright, so the exception no longer applies to anything.
    for (const section of SIDEBAR_SECTIONS) {
      const labels = section.items.map((item) => item.label);
      const labelsHi = section.items.map((item) => item.labelHi);
      expect(new Set(labels).size, `duplicate en label in "${section.title}": ${labels.join(', ')}`).toBe(
        labels.length,
      );
      expect(new Set(labelsHi).size, `duplicate hi label in "${section.title}": ${labelsHi.join(', ')}`).toBe(
        labelsHi.length,
      );
    }
  });

  it('gives one route one name and one icon across BOTH student nav projections', () => {
    // /progress used to be "Me" 🙂 in the bottom tabs and "My Progress" 📈 in
    // the sidebar. Any href appearing in more than one config must now agree on
    // label, labelHi, and icon.
    const byHref = new Map<string, { label: string; labelHi?: string; icon: string }>();
    const all = [
      ...CORE_TABS.map((t) => ({ href: t.href, label: t.label, labelHi: t.labelHi, icon: t.icon })),
      ...MORE_ITEMS.map((t) => ({ href: t.href, label: t.label, labelHi: t.labelHi, icon: t.icon })),
      ...SIDEBAR_SECTIONS.flatMap((s) =>
        s.items.map((t) => ({ href: t.href, label: t.label, labelHi: t.labelHi, icon: t.icon })),
      ),
    ];
    for (const item of all) {
      const seen = byHref.get(item.href);
      if (!seen) {
        byHref.set(item.href, { label: item.label, labelHi: item.labelHi, icon: item.icon });
        continue;
      }
      expect(item.label, `${item.href} has two names`).toBe(seen.label);
      expect(item.labelHi, `${item.href} has two Hindi names`).toBe(seen.labelHi);
      expect(item.icon, `${item.href} has two icons`).toBe(seen.icon);
    }
  });
});
