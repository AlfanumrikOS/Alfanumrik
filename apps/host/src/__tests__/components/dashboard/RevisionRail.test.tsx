import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/**
 * RevisionRail — zero-state reassurance must be SUCCESS-ONLY (no error-as-success).
 *
 * REGRESSION (batch 1c, 2026-07-14): the reassuring "Nothing due right now — nice
 * work" zero-state was previously gated on `dueCount === 0` ALONE. Because
 * `dueCount` falls back to 0 both while the underlying fetch is in flight AND when
 * it errors (useReviewCards returns `data: undefined` in both cases, and
 * `dueCount = Array.isArray(data) ? data.length : 0`), the copy would masquerade
 * as "all caught up" during load and after a failed fetch — a MISLEADING-SUCCESS-
 * ON-ERROR bug on a student-facing surface. The gate is now
 * `!error && loaded && dueCount === 0`. This suite pins that contract:
 *   - renders on a genuine empty-success (resolved empty array, no error),
 *   - is CLOSED while loading / before data resolves (`loaded` guard),
 *   - is CLOSED when the fetch errored (`!error` guard) — the honest error copy
 *     shows instead,
 *   - is CLOSED when items are actually due.
 *
 * Seams (no network, no real SWR):
 *   - `useReviewCards` is mocked to drive { data, isLoading, error } directly.
 *   - `next/dynamic` is mocked so the child <ReviewsDueCard> renders as an inert
 *     marker (its own fetch/SWR stays out of this unit).
 */

// The reassuring zero-state copy (EN + Hindi) — the string under test.
const NICE_WORK_EN = /Nothing due right now/i;
const NICE_WORK_HI = /अभी कोई दोहराव बाकी नहीं/;
// The honest error copy the component shows in place of a false reassurance.
const ERROR_EN = /Couldn't load right now/i;

// ── useReviewCards seam (the spaced-repetition reader RevisionRail counts) ──────
let mockReview: { data: unknown; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: undefined,
};
vi.mock('@alfanumrik/lib/swr', () => ({
  useReviewCards: () => mockReview,
}));

// ── next/dynamic: render the dynamically-imported child as an inert marker ─────
// dynamic() returns this stub WITHOUT invoking the loader, so ReviewsDueCard
// (and its authedFetch/SWR) never loads into this unit.
vi.mock('next/dynamic', () => ({
  default: () =>
    function ReviewsDueCardStub() {
      return React.createElement('div', { 'data-testid': 'reviews-due-card' });
    },
}));

async function renderRail(isHi = false) {
  const { default: RevisionRail } = await import('@alfanumrik/ui/dashboard/os/RevisionRail');
  return render(React.createElement(RevisionRail, { isHi, studentId: 'stu-1' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReview = { data: undefined, isLoading: false, error: undefined };
});

describe('RevisionRail — zero-state reassurance is success-only (no error-as-success)', () => {
  it('renders "nothing due — nice work" ONLY on a genuine success with a resolved empty array', async () => {
    mockReview = { data: [], isLoading: false, error: undefined };
    await renderRail(false);

    expect(screen.getByText(NICE_WORK_EN)).toBeInTheDocument();
    // Never the error copy on a success.
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('does NOT render the reassurance while loading / before data resolves (the `loaded` guard)', async () => {
    // data still undefined (not an array) → loaded=false, dueCount falls back to 0.
    // The OLD gate (`dueCount === 0` alone) would have shown "nice work" here — the bug.
    mockReview = { data: undefined, isLoading: true, error: undefined };
    await renderRail(false);

    expect(screen.queryByText(NICE_WORK_EN)).toBeNull();
    expect(screen.queryByText(ERROR_EN)).toBeNull();
  });

  it('does NOT render the reassurance when the fetch errored — shows the honest error copy instead (misleading-success path closed)', async () => {
    mockReview = { data: undefined, isLoading: false, error: new Error('reviews fetch failed') };
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
    mockReview = { data: undefined, isLoading: true, error: new Error('boom') };
    await renderRail(false);

    expect(screen.queryByText(NICE_WORK_EN)).toBeNull();
    // We are in the else branch, so the child card is mounted (not the error copy).
    expect(screen.getByTestId('reviews-due-card')).toBeInTheDocument();
  });

  it('Hindi (P7): reassurance stays success-only — renders on empty-success, absent on error', async () => {
    mockReview = { data: [], isLoading: false, error: undefined };
    const { unmount } = await renderRail(true);
    expect(screen.getByText(NICE_WORK_HI)).toBeInTheDocument();
    unmount();

    mockReview = { data: undefined, isLoading: false, error: new Error('boom') };
    await renderRail(true);
    expect(screen.queryByText(NICE_WORK_HI)).toBeNull();
  });

  it('does NOT render the reassurance when there ARE items due (dueCount > 0)', async () => {
    mockReview = { data: [{ id: 'c1' }, { id: 'c2' }], isLoading: false, error: undefined };
    await renderRail(false);

    expect(screen.queryByText(NICE_WORK_EN)).toBeNull();
    // The count badge reflects the due items instead.
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
