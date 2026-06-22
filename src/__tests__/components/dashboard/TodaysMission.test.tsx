import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';

/**
 * TodaysMission — the Alfa OS dashboard hero (ff_student_os_v1).
 *
 * Working-tree change under test: the queue block now ALWAYS renders exactly one
 * of {loading skeleton, queue items, actionable empty/error card}. It must never
 * silently collapse to nothing. The empty/error card is bilingual (P7), routes
 * to /learn, and shows a "Try again" retry (mutate) ONLY on an SWR error — and
 * never leaks raw error text.
 *
 * Smallest practical seam: the component reads its queue exclusively through the
 * `useTodayQueue` SWR hook and language through `useAuth().isHi`. Mocking those
 * two (plus next/navigation's router) lets us drive all three queue states
 * deterministically with zero network. This is the same hook-mock pattern used
 * by DailyRhythmQueue.remediation.test.tsx.
 *
 * No engine/scoring assertions here (P1/P2 untouched) — estMinutes are
 * presentation badges only.
 */

// ── useTodayQueue (SWR hook) mock ────────────────────────────────────────────
// Each test sets `mockQueueState` to the SWR return shape it needs.
type QueueState = {
  data: unknown;
  isLoading: boolean;
  error: unknown;
  mutate: () => void;
};
let mockQueueState: QueueState;
const mockMutate = vi.fn();
vi.mock('@/lib/today/use-today-queue', () => ({
  useTodayQueue: () => mockQueueState,
}));

// ── AuthContext mock — student present + isHi toggle ──────────────────────────
let mockIsHi = false;
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ student: { id: 'stu-1' }, isHi: mockIsHi }),
}));

// ── next/navigation router mock ──────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

// A minimal, contract-shaped TodayResponse with two queue items.
function populatedResponse() {
  return {
    schemaVersion: 1,
    resolvedAt: '2026-06-22T03:00:00.000Z',
    primary: {
      type: 'new_topic',
      rank: 1,
      labelKey: 'today.item.new_topic.label',
      subtitleKey: 'today.item.new_topic.subtitle',
      estMinutes: 12,
      deepLink: { route: '/learn/science/3' },
      iconHint: 'book-open',
      reason: 'unstarted_chapter_available',
    },
    queue: [
      {
        type: 'new_topic',
        rank: 1,
        labelKey: 'today.item.new_topic.label',
        subtitleKey: 'today.item.new_topic.subtitle',
        estMinutes: 12,
        deepLink: { route: '/learn/science/3' },
        iconHint: 'book-open',
        reason: 'unstarted_chapter_available',
      },
      {
        type: 'srs_due',
        rank: 2,
        labelKey: 'today.item.srs_due.label',
        subtitleKey: 'today.item.srs_due.subtitle',
        estMinutes: 5,
        deepLink: { route: '/review' },
        iconHint: 'cards-stack',
        reason: 'cards_due',
      },
    ],
    meta: {
      branch: 'introduce_new_topic',
      masterySubjectCount: 1,
      dueReviewCount: 1,
      practicedToday: false,
    },
  };
}

async function renderMission(
  overrides: Partial<React.ComponentProps<typeof import('@/components/dashboard/os/TodaysMission').default>> = {},
) {
  const { default: TodaysMission } = await import('@/components/dashboard/os/TodaysMission');
  return render(
    React.createElement(TodaysMission, {
      isHi: mockIsHi,
      studentName: 'Asha Verma',
      grade: '7',
      subjectCode: 'science',
      todaysTopic: undefined,
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsHi = false;
  mockQueueState = { data: null, isLoading: false, error: null, mutate: mockMutate };
});

describe('TodaysMission — queue block states', () => {
  it('loading: shows the skeleton and NOT the empty card', async () => {
    mockQueueState = { data: null, isLoading: true, error: null, mutate: mockMutate };
    const { container } = await renderMission();

    // Skeleton present (aria-hidden pulse placeholder).
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // No empty/error card while loading.
    expect(screen.queryByTestId('mission-empty-state')).toBeNull();
    // No queue items either.
    expect(screen.queryByTestId('mission-primary-action')).toBeNull();
  });

  it('empty (data null after load): renders the actionable empty card with a /learn CTA, not a blank collapse', async () => {
    mockQueueState = { data: null, isLoading: false, error: null, mutate: mockMutate };
    await renderMission();

    const card = screen.getByTestId('mission-empty-state');
    expect(card).toBeInTheDocument();
    // Actionable CTA exists and routes to /learn.
    const cta = within(card).getByTestId('mission-empty-cta');
    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith('/learn');
    // Empty (not error) → no retry control.
    expect(within(card).queryByTestId('mission-empty-retry')).toBeNull();
    // Skeleton and queue items absent.
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('mission-primary-action')).toBeNull();
  });

  it('empty (empty queue array after load): still renders the actionable empty card', async () => {
    mockQueueState = {
      data: { ...populatedResponse(), queue: [] },
      isLoading: false,
      error: null,
      mutate: mockMutate,
    };
    await renderMission();

    expect(screen.getByTestId('mission-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('mission-primary-action')).toBeNull();
  });

  it('SWR error: renders the fallback card + a retry control that calls mutate, with no raw error text leaked', async () => {
    const leakyError = Object.assign(new Error('today.fetch_failed'), { status: 503 });
    mockQueueState = { data: null, isLoading: false, error: leakyError, mutate: mockMutate };
    const { container } = await renderMission();

    const card = screen.getByTestId('mission-empty-state');
    expect(card).toBeInTheDocument();

    // Retry control present and wired to mutate().
    const retry = within(card).getByTestId('mission-empty-retry');
    fireEvent.click(retry);
    expect(mockMutate).toHaveBeenCalledTimes(1);

    // No raw error text leaked anywhere in the rendered output.
    expect(container.textContent).not.toContain('today.fetch_failed');
    expect(container.textContent).not.toContain('503');
    expect(container.textContent?.toLowerCase()).not.toContain('error');
  });

  it('populated: renders queue items and NOT the empty card', async () => {
    mockQueueState = {
      data: populatedResponse(),
      isLoading: false,
      error: null,
      mutate: mockMutate,
    };
    await renderMission();

    // Primary action present and routes to the primary deep link.
    const primary = screen.getByTestId('mission-primary-action');
    expect(primary).toBeInTheDocument();
    fireEvent.click(primary);
    expect(mockPush).toHaveBeenCalledWith('/learn/science/3');

    // A secondary row is rendered (queue.slice(1,3)).
    expect(screen.getByText(/Reviews due/)).toBeInTheDocument();

    // Empty card + skeleton absent.
    expect(screen.queryByTestId('mission-empty-state')).toBeNull();
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('TodaysMission — bilingual empty/error card (P7)', () => {
  it('renders the English empty-card copy when isHi=false', async () => {
    mockIsHi = false;
    mockQueueState = { data: null, isLoading: false, error: null, mutate: mockMutate };
    await renderMission();

    const card = screen.getByTestId('mission-empty-state');
    expect(card.textContent).toContain('Your learning path is getting ready');
    expect(card.textContent).toContain('Pick a lesson to begin.');
    expect(within(card).getByTestId('mission-empty-cta').textContent).toContain('Pick a lesson');
  });

  it('renders the Hindi empty-card copy when isHi=true', async () => {
    mockIsHi = true;
    mockQueueState = { data: null, isLoading: false, error: null, mutate: mockMutate };
    await renderMission({ isHi: true });

    const card = screen.getByTestId('mission-empty-state');
    expect(card.textContent).toContain('तुम्हारा सीखने का रास्ता तैयार हो रहा है');
    expect(card.textContent).toContain('शुरू करने के लिए एक पाठ चुनो।');
    expect(within(card).getByTestId('mission-empty-cta').textContent).toContain('पाठ चुनो');
  });

  it('renders the Hindi retry label on error when isHi=true', async () => {
    mockIsHi = true;
    mockQueueState = {
      data: null,
      isLoading: false,
      error: new Error('today.fetch_failed'),
      mutate: mockMutate,
    };
    await renderMission({ isHi: true });

    const retry = within(screen.getByTestId('mission-empty-state')).getByTestId(
      'mission-empty-retry',
    );
    expect(retry.textContent).toContain('फिर से कोशिश करें');
  });

  it('renders the English retry label on error when isHi=false', async () => {
    mockIsHi = false;
    mockQueueState = {
      data: null,
      isLoading: false,
      error: new Error('today.fetch_failed'),
      mutate: mockMutate,
    };
    await renderMission();

    const retry = within(screen.getByTestId('mission-empty-state')).getByTestId(
      'mission-empty-retry',
    );
    expect(retry.textContent).toContain('Try again');
  });
});
