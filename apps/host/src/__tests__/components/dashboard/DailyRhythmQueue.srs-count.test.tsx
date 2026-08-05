import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * DailyRhythmQueue — F3 (Foxy North-Star Phase 0): the SRS lane links to
 * /quiz?mode=srs (which serves due spaced_repetition_cards), so the lane
 * COUNT must come from the SAME shared SRS-due predicate the quiz page
 * uses. Wave 3b: the raw due-cards read is now served by
 * /api/learner/srs/due?withItems=1 (RLS-scoped server route), and the
 * client applies the same selectSrsReviewSet selection the quiz page uses.
 *
 * Pins:
 *   1. Count = deduped, single-subject due-card question count (capped at 5)
 *      even when it disagrees with the rhythm queue's srs_review item count.
 *   2. API failure (non-2xx or thrown) → legacy fallback to the rhythm-queue
 *      item count.
 *   3. No student in auth context → API is never called; legacy fallback.
 */

// ── AuthContext mock (student needed to trigger the srs-due fetch) ──────────
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

// ── fetch mock — rhythm queue + /api/learner/srs/due ────────────────────────
type DueItem = { id: string; sourceId: string | null; subject: string | null };
interface FetchStub {
  srsItemCount: number;
  srsDueBody: { count: number; items?: DueItem[] } | null;
  /** When true, /api/learner/srs/due returns 500. */
  srsDueFail: boolean;
}

function stubFetch(stub: FetchStub) {
  const items = [
    ...Array.from({ length: stub.srsItemCount }, (_, i) => ({
      kind: 'srs_review',
      questionId: `q-${i}`,
    })),
    { kind: 'reflection', promptText: 'What clicked today?', promptTextHi: 'आज क्या समझ आया?' },
  ];
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/rhythm/today')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items, composedAtIso: '2026-08-05T03:00:00.000Z' }),
      } as Response;
    }
    if (url.startsWith('/api/learner/srs/due')) {
      if (stub.srsDueFail) {
        return { ok: false, status: 500, json: async () => ({ success: false }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, ...(stub.srsDueBody ?? { count: 0, items: [] }) }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
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
});

describe('DailyRhythmQueue — SRS lane count from /api/learner/srs/due (F3, wave 3b)', () => {
  it('shows the due-card count (deduped, single subject) even when the rhythm queue disagrees', async () => {
    stubFetch({
      srsItemCount: 2, // rhythm queue claims 2 srs_review items
      srsDueFail: false,
      srsDueBody: {
        count: 5,
        items: [
          { id: 'c1', sourceId: 'q1', subject: 'science' },
          { id: 'c2', sourceId: 'q1', subject: 'science' }, // dup question → deduped
          { id: 'c3', sourceId: 'q2', subject: 'science' },
          { id: 'c4', sourceId: 'q3', subject: 'science' },
          { id: 'c5', sourceId: 'q9', subject: 'math' }, // other subject → excluded
        ],
      },
    });
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
    stubFetch({
      srsItemCount: 1,
      srsDueFail: false,
      srsDueBody: {
        count: 9,
        items: Array.from({ length: 9 }, (_, i) => ({
          id: `c${i}`,
          sourceId: `q${i}`,
          subject: 'science',
        })),
      },
    });
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');
    await waitFor(() => {
      expect(screen.getByTestId('rhythm-srs-count').textContent).toBe('5/5');
    });
  });

  it('falls back to the rhythm-queue item count when /api/learner/srs/due fails (fail-soft)', async () => {
    stubFetch({ srsItemCount: 2, srsDueFail: true, srsDueBody: null });
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');
    // Legacy behavior preserved: srs.length from /api/rhythm/today.
    await waitFor(() => {
      expect(screen.getByTestId('rhythm-srs-count').textContent).toBe('2/5');
    });
  });

  it('renders the legacy count when no student is in the auth context (API not called)', async () => {
    mockStudent = null;
    const spy = stubFetch({ srsItemCount: 2, srsDueFail: false, srsDueBody: { count: 0, items: [] } });
    await renderQueue();
    await screen.findByTestId('daily-rhythm-queue');
    expect(screen.getByTestId('rhythm-srs-count').textContent).toBe('2/5');
    // The srs-due endpoint should never be called without a student.
    const dueCalls = spy.mock.calls.filter((c) => String(c[0]).startsWith('/api/learner/srs/due'));
    expect(dueCalls).toHaveLength(0);
  });
});
