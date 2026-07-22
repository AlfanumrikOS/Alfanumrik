import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/**
 * PracticeCenter — Alfa OS Practice Center container (ff_practice_os_v1,
 * presentation-only). Launch prerequisite coverage (Master Action Plan 2.5):
 * the four render states + bilingual copy on the above-the-fold sections that
 * ship statically (PracticeHeader, QuickStartCTA, DuePracticeCard).
 *
 * Seams (no network, no real SWR):
 *   - `swr` is mocked so usePracticeHistory returns { data, isLoading, error }
 *     directly (the container's data spine — GET /api/practice/history).
 *   - `@alfanumrik/lib/swr` (useStudentSnapshot, the header streak reader) and
 *     `@alfanumrik/lib/use-cosmic-light-surface` are stubbed inert.
 *   - `next/dynamic` renders the below-the-fold lazy sections as inert markers
 *     so their own fetch/SWR stays out of this unit.
 *   - `next/navigation` useRouter is stubbed for the CTA handoffs.
 */

let mockSwr: { data: unknown; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: undefined,
};
vi.mock('swr', () => ({
  default: () => mockSwr,
}));

vi.mock('@alfanumrik/lib/swr', () => ({
  useStudentSnapshot: () => ({ data: undefined }),
}));

vi.mock('@alfanumrik/lib/use-cosmic-light-surface', () => ({
  useCosmicLightSurface: () => {},
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function LazySectionStub() {
      return React.createElement('div', { 'data-testid': 'lazy-section' });
    },
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

function history(overrides: {
  last7Days?: number;
  dueReviewCount?: number;
} = {}) {
  return {
    sessions: [],
    stats: {
      totalSessions: 0,
      last7Days: overrides.last7Days ?? 0,
      avgScore: 0,
      dueReviewCount: overrides.dueReviewCount ?? 0,
    },
    errorPatterns: [],
    bloomDistribution: [],
  };
}

async function renderCenter(isHi = false) {
  const { default: PracticeCenter } = await import('@alfanumrik/ui/practice/os/PracticeCenter');
  return render(
    React.createElement(PracticeCenter, { studentId: 'stu-1', grade: '8', isHi }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSwr = { data: undefined, isLoading: false, error: undefined };
});

describe('PracticeCenter — Alfa OS Practice Center container', () => {
  it('LOADING: header shows an aria-busy skeleton; the Quick-Start CTA still renders', async () => {
    mockSwr = { data: undefined, isLoading: true, error: undefined };
    const { container } = await renderCenter(false);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.getByText(/Start a practice quiz/i)).toBeInTheDocument();
  });

  it('ERROR: shows the distinct error copy (not empty), for both header and due card', async () => {
    mockSwr = { data: undefined, isLoading: false, error: new Error('500') };
    await renderCenter(false);
    expect(screen.getByText(/Couldn't load your practice summary right now/i)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load what's due for practice right now/i)).toBeInTheDocument();
  });

  it('EMPTY: encouraging zero-state (start practising / nothing due), never an error', async () => {
    mockSwr = { data: history(), isLoading: false, error: undefined };
    await renderCenter(false);
    expect(screen.getByText(/Start practising this week/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing due for practice right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/i)).not.toBeInTheDocument();
  });

  it('POPULATED: renders sessions-this-week count and the due-for-practice nudge', async () => {
    mockSwr = {
      data: history({ last7Days: 3, dueReviewCount: 2 }),
      isLoading: false,
      error: undefined,
    };
    await renderCenter(false);
    expect(screen.getByText(/3 sessions this week/i)).toBeInTheDocument();
    expect(screen.getByText(/Due for practice/i)).toBeInTheDocument();
  });

  it('BILINGUAL (Hindi): header, CTA and due nudge render Devanagari copy', async () => {
    mockSwr = {
      data: history({ last7Days: 3, dueReviewCount: 2 }),
      isLoading: false,
      error: undefined,
    };
    await renderCenter(true);
    expect(screen.getByText('अभ्यास केंद्र')).toBeInTheDocument();
    expect(screen.getByText('अभ्यास शुरू करो')).toBeInTheDocument();
    expect(screen.getByText(/अभ्यास के लिए बकाया/)).toBeInTheDocument();
  });
});
