import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/**
 * RevisionRail — (1) zero-state reassurance must be SUCCESS-ONLY, and (2) the
 * badge and the CTA must come from ONE source.
 *
 * REGRESSION (batch 1c, 2026-07-14): the reassuring "Nothing due right now — nice
 * work" zero-state was previously gated on `dueCount === 0` ALONE. Because
 * `dueCount` falls back to 0 both while the underlying fetch is in flight AND when
 * it errors, the copy would masquerade as "all caught up" during load and after a
 * failed fetch — a MISLEADING-SUCCESS-ON-ERROR bug on a student-facing surface.
 * The gate is `!error && loaded && dueCount === 0`. That contract is unchanged
 * and still pinned below.
 *
 * REGRESSION (defect #7, 2026-08): the rail used to show TWO contradictory
 * numbers in one card. The badge read `useReviewCards` → get_review_cards →
 * `spaced_repetition_cards` (19 rows platform-wide; nothing writes it from a
 * quiz, so ~always 0), while the nested <ReviewsDueCard> read
 * /api/dashboard/reviews-due → `concept_mastery.next_review_at` (a real number).
 * Both now derive from a single /api/revision/overview payload, and the count is
 * handed to the card as a PROP so the two can no longer disagree.
 *
 * Seams (no network, no real SWR):
 *   - `useRevisionOverview` is mocked to drive { data, isLoading, error } directly.
 *   - `next/dynamic` is mocked so the child <ReviewsDueCard> renders as a marker
 *     that echoes the props it received (its own fetch/SWR stays out of this unit).
 */

// The reassuring zero-state copy (EN + Hindi) — the string under test.
const NICE_WORK_EN = /Nothing due right now/i;
const NICE_WORK_HI = /अभी कोई दोहराव बाकी नहीं/;
// The honest error copy the component shows in place of a false reassurance.
const ERROR_EN = /Couldn't load right now/i;

// ── useRevisionOverview seam (the SINGLE reader the rail now uses) ─────────────
let mockOverview: { data: unknown; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: undefined,
};
vi.mock('@alfanumrik/ui/review/os/useRevisionOverview', () => ({
  useRevisionOverview: () => mockOverview,
}));

// Guard: the dead `spaced_repetition_cards` reader must not come back. Any
// import of it from the rail would blow up on this deliberately-throwing stub.
vi.mock('@alfanumrik/lib/swr', () => ({
  useReviewCards: () => {
    throw new Error('RevisionRail must not read spaced_repetition_cards');
  },
}));

// ── next/dynamic: render the dynamically-imported child as a prop-echoing marker
// dynamic() returns this stub WITHOUT invoking the loader, so ReviewsDueCard
// (and its authedFetch/SWR) never loads into this unit.
vi.mock('next/dynamic', () => ({
  default: () =>
    function ReviewsDueCardStub(props: { dueCount?: number; estimatedMinutes?: number }) {
      return React.createElement('div', {
        'data-testid': 'reviews-due-card',
        'data-due-count': String(props?.dueCount ?? ''),
        'data-estimated-minutes': String(props?.estimatedMinutes ?? ''),
      });
    },
}));

function overview(overdue: number, dueToday: number, estimatedMinutes = 0) {
  return {
    overdue: { count: overdue, items: [] },
    dueToday: { count: dueToday, items: [] },
    upcoming: { count: 0, byDay: [], items: [] },
    estimatedMinutes,
    subjects: [],
  };
}

async function renderRail(isHi = false) {
  const { default: RevisionRail } = await import('@alfanumrik/ui/dashboard/os/RevisionRail');
  return render(React.createElement(RevisionRail, { isHi, studentId: 'stu-1' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOverview = { data: undefined, isLoading: false, error: undefined };
});

describe('RevisionRail — zero-state reassurance is success-only (no error-as-success)', () => {
  it('renders "nothing due — nice work" ONLY on a genuine success with a resolved payload', async () => {
    mockOverview = { data: overview(0, 0), isLoading: false, error: undefined };
    await renderRail(false);

    expect(screen.getByText(NICE_WORK_EN)).toBeInTheDocument();
    // Never the error copy on a success.
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('does NOT render the reassurance while loading / before data resolves (the `loaded` guard)', async () => {
    // data still undefined → loaded=false, dueCount falls back to 0.
    // The OLD gate (`dueCount === 0` alone) would have shown "nice work" here — the bug.
    mockOverview = { data: undefined, isLoading: true, error: undefined };
    await renderRail(false);

    expect(screen.queryByText(NICE_WORK_EN)).toBeNull();
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('does NOT render the reassurance when the fetch errored — shows the honest error copy instead (misleading-success path closed)', async () => {
    mockOverview = { data: undefined, isLoading: false, error: new Error('overview fetch failed') };
    await renderRail(false);

    // The reassuring copy must be absent…
    expect(screen.queryByText(NICE_WORK_EN)).toBeNull();
    // …and the honest error copy present.
    expect(screen.getByText(ERROR_EN)).toBeInTheDocument();
  });

  it('does NOT render the reassurance when an error coincides with an in-flight load (the `!error` guard on the zero-state)', async () => {
    // error truthy AND isLoading truthy → the top-level `error && !isLoading` error
    // branch is NOT taken, so the else branch renders. Here the zero-state's own
    // `!error` guard is the ONLY thing closing the false-reassurance path.
    mockOverview = { data: undefined, isLoading: true, error: new Error('boom') };
    await renderRail(false);

    expect(screen.queryByText(NICE_WORK_EN)).toBeNull();
    // We are in the else branch, so the child card is mounted (not the error copy).
    expect(screen.getByTestId('reviews-due-card')).toBeInTheDocument();
  });

  it('Hindi (P7): reassurance stays success-only — renders on empty-success, absent on error', async () => {
    mockOverview = { data: overview(0, 0), isLoading: false, error: undefined };
    const { unmount } = await renderRail(true);
    expect(screen.getByText(NICE_WORK_HI)).toBeInTheDocument();
    unmount();

    mockOverview = { data: undefined, isLoading: false, error: new Error('boom') };
    await renderRail(true);
    expect(screen.queryByText(NICE_WORK_HI)).toBeNull();
  });

  it('does NOT render the reassurance when there ARE items due (dueCount > 0)', async () => {
    mockOverview = { data: overview(1, 1), isLoading: false, error: undefined };
    await renderRail(false);

    expect(screen.queryByText(NICE_WORK_EN)).toBeNull();
    // The count badge reflects the due items instead.
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('RevisionRail — ONE number, ONE source (defect #7)', () => {
  it('badge = overdue + dueToday from /api/revision/overview', async () => {
    mockOverview = { data: overview(4, 2, 9), isLoading: false, error: undefined };
    await renderRail(false);
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('hands that SAME number to ReviewsDueCard as a prop — the two cannot disagree', async () => {
    mockOverview = { data: overview(4, 2, 9), isLoading: false, error: undefined };
    await renderRail(false);

    const card = screen.getByTestId('reviews-due-card');
    expect(card.getAttribute('data-due-count')).toBe('6');
    expect(card.getAttribute('data-estimated-minutes')).toBe('9');
    // Same value the badge shows.
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});
