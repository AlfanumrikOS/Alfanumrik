import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/**
 * RevisionCenter — Alfa OS Revision Center container (ff_revision_os_v1,
 * presentation-only). Launch prerequisite coverage (Master Action Plan 2.5):
 * the four render states + bilingual copy on the statically-shipped
 * above-the-fold sections (RevisionHeader, StartRevisionCTA).
 *
 * Seams: `swr` drives useRevisionOverview's { data, isLoading, error }
 * (GET /api/revision/overview) directly; useStudentSnapshot, the cosmic-light
 * surface hook, next/dynamic (lazy buckets/schedule/load) and next/navigation
 * are all stubbed inert so no network or child fetch enters this unit.
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

function overview(overrides: {
  overdue?: number;
  dueToday?: number;
  upcoming?: number;
  estimatedMinutes?: number;
} = {}) {
  return {
    overdue: { count: overrides.overdue ?? 0, items: [] },
    dueToday: { count: overrides.dueToday ?? 0, items: [] },
    upcoming: { count: overrides.upcoming ?? 0, byDay: [], items: [] },
    estimatedMinutes: overrides.estimatedMinutes ?? 0,
    subjects: [],
  };
}

async function renderCenter(isHi = false) {
  const { default: RevisionCenter } = await import('@alfanumrik/ui/review/os/RevisionCenter');
  return render(React.createElement(RevisionCenter, { studentId: 'stu-1', isHi }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSwr = { data: undefined, isLoading: false, error: undefined };
});

describe('RevisionCenter — Alfa OS Revision Center container', () => {
  it('LOADING: the Start CTA reads "Loading…" while the overview resolves', async () => {
    mockSwr = { data: undefined, isLoading: true, error: undefined };
    await renderCenter(false);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('ERROR: shows the distinct revision-list error copy (not empty)', async () => {
    mockSwr = { data: undefined, isLoading: false, error: new Error('500') };
    await renderCenter(false);
    expect(screen.getByText(/Couldn't load your revision list right now/i)).toBeInTheDocument();
  });

  it('EMPTY: all-caught-up zero-state + a "Revise anyway" CTA, never an error', async () => {
    mockSwr = { data: overview(), isLoading: false, error: undefined };
    await renderCenter(false);
    expect(screen.getByText(/All caught up — nice work/i)).toBeInTheDocument();
    expect(screen.getByText(/Revise anyway/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/i)).not.toBeInTheDocument();
  });

  it('POPULATED: shows the due-now count and a "Start revising" CTA', async () => {
    mockSwr = {
      data: overview({ overdue: 2, dueToday: 1, estimatedMinutes: 8 }),
      isLoading: false,
      error: undefined,
    };
    await renderCenter(false);
    expect(screen.getByText(/3 topics to revise now/i)).toBeInTheDocument();
    expect(screen.getByText(/Start revising/i)).toBeInTheDocument();
  });

  it('BILINGUAL (Hindi): header + CTA render Devanagari copy', async () => {
    mockSwr = {
      data: overview({ overdue: 2, dueToday: 1 }),
      isLoading: false,
      error: undefined,
    };
    await renderCenter(true);
    expect(screen.getByText('दोहराव केंद्र')).toBeInTheDocument();
    expect(screen.getByText('दोहराव शुरू करो')).toBeInTheDocument();
  });
});
