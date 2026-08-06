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
import { CORE_TABS, MORE_ITEMS, SIDEBAR_SECTIONS } from '@alfanumrik/ui/navigation/nav-config';

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

  it('groups the More sheet overflow into Practice / Study / Account headers (2026-08-06 declutter)', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const dialog = screen.getByRole('dialog', { name: 'More navigation options' });

    // Ungrouped "Home" stays first; the flat 19-item list is now three sections
    // mirroring the desktop sidebar (IA law — same mental model both projections).
    expect(within(dialog).getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(within(dialog).getByText('Practice')).toBeInTheDocument();
    expect(within(dialog).getByText('Study')).toBeInTheDocument();
    expect(within(dialog).getByText('Account')).toBeInTheDocument();

    // Section membership is preserved — items render inside their group, not lost.
    expect(within(dialog).getByRole('button', { name: 'STEM Lab' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Profile' })).toBeInTheDocument();
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
    // The sidebar entry for the live quiz engine used to be labelled
    // "Practice" — identical to its own section title and a near-twin of
    // "Practice Center" (/practice) directly above it. It was renamed to
    // "Quiz" on 2026-08-05; the DESTINATION is what this test guards and it is
    // unchanged. Asserted by href-first lookup so a future rename does not
    // silently make this test vacuous the way a label-first lookup did.
    const quizItems = SIDEBAR_SECTIONS.flatMap((section) => section.items).filter(
      (item) => item.href === '/quiz',
    );
    expect(quizItems).toHaveLength(1);
    expect(quizItems[0].label).toBe('Quiz');
    expect(quizItems[0].labelHi).toBe('क्विज़');
  });

  it('gives every sidebar entry a distinct name within its section (en + hi)', () => {
    // IA law "one destination = one name". The Practice section previously read
    // "Practice > Practice Center / Practice" — the same word three times
    // meaning three things. Hindi is asserted too so a rename cannot fix the
    // English collision while leaving the Hindi one (P7).
    //
    // NOTE: the Home section still contains an item also called "Home"
    // (/dashboard). That is a section title matching its own landing item, not
    // two rival destinations, and is deliberately out of scope here.
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
