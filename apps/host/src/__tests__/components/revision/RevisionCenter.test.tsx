import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

// ── REG-421: hermetic Supabase client seam ────────────────────────────────────
// useRevisionOverview's fetcher calls authedFetch(), and authed-fetch.ts reads
// the live session via `@alfanumrik/lib/supabase-client` — a DIFFERENT specifier
// from `@alfanumrik/lib/supabase` (which merely re-exports it). vi.mock is keyed
// by specifier string, so only this exact one cuts the seam. Left unmocked, a
// render would build a real @supabase/supabase-js client and await a real
// auth.getSession() (localStorage read + possible token refresh) inside the
// render window — the parents-page shard flake of 2026-08-23.
//
// The `swr` mock above already short-circuits the fetcher in this file's current
// tests, so this is belt-and-braces: it keeps the guarantee true for any future
// test here that lets the real fetcher run.
vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
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

function item(overrides: Partial<{
  topicId: string;
  title: string;
  titleHi: string | null;
  subject: string;
  dueDate: string;
  daysOverdue: number;
  masteryProbability: number;
}> = {}) {
  return {
    topicId: overrides.topicId ?? 'topic-1',
    title: overrides.title ?? 'Real Numbers',
    titleHi: overrides.titleHi ?? null,
    // /api/revision/overview selects `subjects.code` — already a CODE.
    subject: overrides.subject ?? 'math',
    dueDate: overrides.dueDate ?? '2026-08-20',
    daysOverdue: overrides.daysOverdue ?? 3,
    masteryProbability: overrides.masteryProbability ?? 0.3,
  };
}

function overview(overrides: {
  overdue?: number;
  dueToday?: number;
  upcoming?: number;
  estimatedMinutes?: number;
  overdueItems?: ReturnType<typeof item>[];
  dueTodayItems?: ReturnType<typeof item>[];
} = {}) {
  return {
    overdue: { count: overrides.overdue ?? 0, items: overrides.overdueItems ?? [] },
    dueToday: { count: overrides.dueToday ?? 0, items: overrides.dueTodayItems ?? [] },
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


/* ── Defect #7: every revision CTA must land on the topic it promised ──────
 *
 * Before this change the whole `review/os` directory contained exactly ONE
 * router.push, and it was a CONSTANT: `/refresh?tab=flashcards`, regardless of
 * which topics were due. A student told "3 topics · ~8 min" was handed a
 * generic flashcard screen backed by `spaced_repetition_cards` — a table no
 * quiz writes — so the next thing they read was "Nothing to refresh right now".
 */
describe('StartRevisionCTA — opens the topic it just named (defect #7)', () => {
  it('routes to the FIRST OVERDUE topic, carrying topic_id + subject CODE', async () => {
    mockSwr = {
      data: overview({
        overdue: 2,
        estimatedMinutes: 5,
        overdueItems: [
          item({ topicId: 'topic-overdue-1', title: 'Real Numbers', subject: 'math' }),
          item({ topicId: 'topic-overdue-2', title: 'Polynomials', subject: 'math' }),
        ],
      }),
      isLoading: false,
      error: undefined,
    };
    await renderCenter(false);
    fireEvent.click(screen.getByText(/Start revising/i));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const dest = String(mockPush.mock.calls[0][0]);
    expect(dest.startsWith('/foxy?')).toBe(true);
    const q = new URLSearchParams(dest.slice('/foxy?'.length));
    expect(q.get('topic_id')).toBe('topic-overdue-1');
    expect(q.get('subject')).toBe('math');
    expect(q.get('mode')).toBe('revise');
    // The dead unscoped destination must NOT be used when a topic exists.
    expect(dest).not.toContain('/refresh');
  });

  it('falls back to the first DUE-TODAY topic when nothing is overdue', async () => {
    mockSwr = {
      data: overview({
        dueToday: 1,
        dueTodayItems: [item({ topicId: 'topic-today', subject: 'science' })],
      }),
      isLoading: false,
      error: undefined,
    };
    await renderCenter(false);
    fireEvent.click(screen.getByText(/Start revising/i));

    const q = new URLSearchParams(String(mockPush.mock.calls[0][0]).slice('/foxy?'.length));
    expect(q.get('topic_id')).toBe('topic-today');
    expect(q.get('subject')).toBe('science');
  });

  it('names the topic in the sub-label, so the promise and the destination match', async () => {
    mockSwr = {
      data: overview({
        overdue: 1,
        estimatedMinutes: 2,
        overdueItems: [item({ title: 'Real Numbers' })],
      }),
      isLoading: false,
      error: undefined,
    };
    await renderCenter(false);
    expect(screen.getByText(/Real Numbers/)).toBeInTheDocument();
  });

  it('only falls back to the unscoped flashcard session when there is genuinely nothing due', async () => {
    mockSwr = { data: overview(), isLoading: false, error: undefined };
    await renderCenter(false);
    fireEvent.click(screen.getByText(/Revise anyway/i));
    expect(mockPush).toHaveBeenCalledWith('/refresh?tab=flashcards');
  });
});

/* DueBuckets is dynamic-imported inside RevisionCenter (stubbed above), so it
 * is exercised directly here. It previously had NO per-topic action at all: a
 * student could expand "Overdue", read the topics they were behind on, and had
 * no way to act on any single one. */
describe('DueBuckets — every row is its own "Revise" action (defect #7)', () => {
  async function renderBuckets(isHi = false) {
    const { default: DueBuckets } = await import('@alfanumrik/ui/review/os/DueBuckets');
    return render(
      React.createElement(DueBuckets, {
        overdue: {
          kind: 'overdue' as const,
          count: 2,
          items: [
            item({ topicId: 'tid-a', title: 'Real Numbers', subject: 'math' }),
            item({ topicId: 'tid-b', title: 'Light', subject: 'science', titleHi: 'प्रकाश' }),
          ],
        },
        dueToday: { kind: 'dueToday' as const, count: 0, items: [] },
        upcoming: { kind: 'upcoming' as const, count: 0, items: [] },
        isLoading: false,
        error: undefined,
        isHi,
      }),
    );
  }

  it('renders one topic-scoped link per row carrying topic_id + subject CODE', async () => {
    await renderBuckets(false);
    const links = screen.getAllByTestId('revise-topic-link') as HTMLAnchorElement[];
    expect(links).toHaveLength(2);

    const first = new URLSearchParams(links[0].getAttribute('href')!.slice('/foxy?'.length));
    expect(first.get('topic_id')).toBe('tid-a');
    expect(first.get('subject')).toBe('math');
    expect(first.get('mode')).toBe('revise');

    const second = new URLSearchParams(links[1].getAttribute('href')!.slice('/foxy?'.length));
    expect(second.get('topic_id')).toBe('tid-b');
    expect(second.get('subject')).toBe('science');
  });

  it('names the topic in each accessible label (not N identical "Revise" links)', async () => {
    await renderBuckets(false);
    expect(screen.getByLabelText('Revise Real Numbers')).toBeInTheDocument();
    expect(screen.getByLabelText('Revise Light')).toBeInTheDocument();
  });

  it('BILINGUAL (P7): Hindi label + Hindi topic title in the accessible name', async () => {
    await renderBuckets(true);
    expect(screen.getByLabelText(/प्रकाश — यही दोहराओ/)).toBeInTheDocument();
  });
});
