import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * DailyRhythmQueue — F3 (Foxy North-Star Phase 0): the SRS lane links to
 * /quiz?mode=srs (which serves due spaced_repetition_cards), so the lane
 * COUNT must come from the SAME shared due-cards query + selection
 * (fetchSrsDueQuizCards + selectSrsReviewSet), NOT from the
 * concept_mastery-sourced srs_review items in /api/rhythm/today.
 *
 * Pins:
 *   1. Count = deduped, single-subject due-card question count (capped at 5)
 *      even when it disagrees with the rhythm queue's srs_review item count.
 *   2. No student in auth context (or a failing query) → legacy fallback to
 *      the rhythm-queue item count (existing tests cover that shape; here we
 *      pin the failure fallback explicitly).
 */

// ── AuthContext mock (now includes student — the count query needs it) ──────
let mockIsHi = false;
let mockStudent: { id: string } | null = { id: 'stu-1' };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi, student: mockStudent }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@alfanumrik/lib/posthog/dashboard-cta', () => ({
  trackDashboardCta: vi.fn(),
}));

// ── supabase mock (resolved via the component's dynamic import) ─────────────
const supabaseState = {
  dueCards: [] as Array<{ id: string; source_id: string | null; subject: string | null }>,
  throwOnQuery: false,
};

vi.mock('@alfanumrik/lib/supabase', () => {
  function makeChain(table: string) {
    if (supabaseState.throwOnQuery) throw new Error('query failed');
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'lte', 'order', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'spaced_repetition_cards' ? supabaseState.dueCards : [],
        error: null,
      }).then(resolve);
    return chain;
  }
  return {
    supabase: { from: vi.fn((table: string) => makeChain(table)) },
  };
});

// ── fetch mock: rhythm queue with TWO srs_review items (the stale count) ────
function stubFetch(srsItemCount: number) {
  const items = [
    ...Array.from({ length: srsItemCount }, (_, i) => ({
      kind: 'srs_review',
      questionId: `q-${i}`,
    })),
    { kind: 'reflection', promptText: 'What clicked today?', promptTextHi: 'आज क्या समझ आया?' },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/rhythm/today')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items, composedAtIso: '2026-08-05T03:00:00.000Z' }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }),
  );
}

async function renderQueue() {
  const { default: DailyRhythmQueue } = await import(
    '@alfanumrik/ui/dashboard/sections/DailyRhythmQueue'
  );
  return render(React.createElement(DailyRhythmQueue));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockIsHi = false;
  mockStudent = { id: 'stu-1' };
  supabaseState.dueCards = [];
  supabaseState.throwOnQuery = false;
});

describe('DailyRhythmQueue — SRS lane count from spaced_repetition_cards (F3)', () => {
  it('shows the due-card count (deduped, single subject) even when the rhythm queue disagrees', async () => {
    stubFetch(2); // rhythm queue claims 2 srs_review items
    supabaseState.dueCards = [
      { id: 'c1', source_id: 'q1', subject: 'science' },
      { id: 'c2', source_id: 'q1', subject: 'science' }, // dup question → deduped
      { id: 'c3', source_id: 'q2', subject: 'science' },
      { id: 'c4', source_id: 'q3', subject: 'science' },
      { id: 'c5', source_id: 'q9', subject: 'math' }, // other subject → excluded
    ];
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');

    // 3 unique science questions due — NOT the rhythm queue's 2.
    await waitFor(() => {
      expect(screen.getByTestId('rhythm-srs-count').textContent).toBe('3/5');
    });
    // The lane still deep-links to the SRS quiz.
    expect(screen.getByTestId('rhythm-srs-cta').getAttribute('href')).toBe('/quiz?mode=srs');
  });

  it('caps the displayed count at 5 (lane renders n/5)', async () => {
    stubFetch(1);
    supabaseState.dueCards = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      source_id: `q${i}`,
      subject: 'science',
    }));
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');
    await waitFor(() => {
      expect(screen.getByTestId('rhythm-srs-count').textContent).toBe('5/5');
    });
  });

  it('falls back to the rhythm-queue item count when the due-card query fails (fail-soft)', async () => {
    stubFetch(2);
    supabaseState.throwOnQuery = true;
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');
    // Legacy behavior preserved: srs.length from /api/rhythm/today.
    expect(screen.getByTestId('rhythm-srs-count').textContent).toBe('2/5');
  });

  it('renders the legacy count when no student is in the auth context', async () => {
    mockStudent = null;
    stubFetch(2);
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');
    expect(screen.getByTestId('rhythm-srs-count').textContent).toBe('2/5');
  });
});
