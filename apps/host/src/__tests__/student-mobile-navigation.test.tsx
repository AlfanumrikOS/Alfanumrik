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
import { SIDEBAR_SECTIONS } from '@alfanumrik/ui/navigation/nav-config';

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

  it('routes the live Practice destination to the working quiz experience', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const dialog = screen.getByRole('dialog', { name: 'More navigation options' });
    expect(within(dialog).queryByRole('button', { name: 'Practice' })).not.toBeInTheDocument();

    const practiceItem = SIDEBAR_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.label === 'Practice',
    );
    expect(practiceItem?.href).toBe('/quiz');
  });
});
