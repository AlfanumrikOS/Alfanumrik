import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

/**
 * Alfa Momentum — Wave 2 (dashboard premium elevation) value-bearing visuals.
 *
 * Wave 2 was presentation-only: tokenization (hardcoded brand hex → semantic
 * CSS vars), primitive adoption (MasteryRing → StatRing in BoardScoreWidget,
 * added a mastered-share StatRing to MasterySnapshot), warm-channel tints, and
 * a rebuilt DashboardSkeleton. No engine/scoring code changed (P1/P2 untouched).
 *
 * These tests pin the VALUE-BEARING half of those changes — the numbers the
 * student reads off the new visualizations, plus token-purity on the changed
 * surfaces — following the patterns in:
 *   - momentum-primitives.test.tsx (token-purity via inline-style scan)
 *   - TodaysMission.test.tsx       (hook-mock seam for SWR-fed components)
 *
 * JSDOM has no layout/CSS, so we assert DOM structure, rendered text, ARIA, and
 * the ABSENCE of 6-digit brand hex literals — never computed visual styles.
 */

// ── Token-purity helpers (shared with momentum-primitives.test.tsx) ───────────
function inlineStyles(root: HTMLElement): string {
  return Array.from(root.querySelectorAll<HTMLElement>('[style]'))
    .map((el) => el.getAttribute('style') ?? '')
    .join(' | ');
}

/**
 * Token-driven surfaces forbid 6-digit hex BRAND literals (#15803D, #8B5CF6,
 * #F97316, #DC2626 …). The components legitimately use `var(--token, #fallback)`
 * inline-fallback syntax, so we strip the `var(--…, …)` fallback slot before
 * scanning — the assertion is "no UNGUARDED brand hex", i.e. no hex that is not
 * a documented token fallback. `#fff`/`#000` 3-digit anchors are never brand
 * tokens and are not 6-digit, so they never trip this.
 */
const SIX_DIGIT_HEX = /#[0-9a-fA-F]{6}\b/;
function stripVarFallbacks(styles: string): string {
  // Remove the ", #hex)" fallback portion inside every var(--name, #hex).
  return styles.replace(/var\(\s*--[^,)]+,[^)]*\)/g, 'var(--token)');
}

// ─────────────────────────────────────────────────────────────────────────────
// MasterySnapshot — bucket counts + new StatRing mastered-share denominator
// ─────────────────────────────────────────────────────────────────────────────

// Drive the component's only data seam: the useMasteryOverview SWR hook.
type SwrState = { data: unknown; isLoading: boolean; error: unknown };
let mockMasteryState: SwrState;
vi.mock('@/lib/swr', () => ({
  useMasteryOverview: () => mockMasteryState,
}));

// One overview row per topic. `mastery_level` + `due_for_review` are the only
// fields countBuckets / bucketForRow read.
function row(
  topic_id: string,
  mastery_level: string,
  due_for_review = false,
): Record<string, unknown> {
  return {
    topic_id,
    title: topic_id,
    mastery_level,
    mastery_probability: 0.5,
    due_for_review,
    subject: 'science',
  };
}

async function renderMastery(isHi = false) {
  const { default: MasterySnapshot } = await import(
    '@/components/dashboard/os/MasterySnapshot'
  );
  return render(
    React.createElement(MasterySnapshot, { isHi, studentId: 'stu-1' }),
  );
}

describe('Wave 2 — MasterySnapshot value-bearing visuals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMasteryState = { data: undefined, isLoading: false, error: null };
  });

  it('renders the three bucket counts correctly from the overview rows', async () => {
    // 4 mastered, 3 learning (beginner/developing/proficient), 2 needs-revision
    // (due_for_review wins regardless of level), 1 not_started (excluded).
    mockMasteryState = {
      data: [
        row('m1', 'mastered'),
        row('m2', 'mastered'),
        row('m3', 'mastered'),
        row('m4', 'mastered'),
        row('l1', 'beginner'),
        row('l2', 'developing'),
        row('l3', 'proficient'),
        row('r1', 'proficient', true), // due → needs-revision
        row('r2', 'mastered', true), // due wins over mastered
        row('x1', 'not_started'), // excluded from the tally
      ],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(false);

    // role="list" enumerates the three buckets; each row's aria-label encodes
    // "<label>: <count> topics" — assert the count per bucket by aria-label.
    const items = within(
      container.querySelector('[role="list"]') as HTMLElement,
    ).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('aria-label', expect.stringContaining('Mastered: 4'));
    expect(items[1]).toHaveAttribute('aria-label', expect.stringContaining('Learning: 3'));
    expect(items[2]).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Needs Revision: 2'),
    );

    // Total chip = 4 + 3 + 2 = 9 (not_started excluded).
    expect(screen.getByText(/9/)).toBeInTheDocument();
  });

  it('new StatRing mastered-share uses the CORRECT denominator (mastered / total, not /all-rows)', async () => {
    // 3 mastered out of 6 BUCKETED topics (one not_started must NOT inflate the
    // denominator). Correct share = round(3/6 * 100) = 50%. A naive /all-rows
    // denominator (3/7) would yield 43% — the bug this test guards.
    mockMasteryState = {
      data: [
        row('m1', 'mastered'),
        row('m2', 'mastered'),
        row('m3', 'mastered'),
        row('l1', 'beginner'),
        row('l2', 'developing'),
        row('r1', 'proficient', true),
        row('x1', 'not_started'), // excluded — must not change the denominator
      ],
      isLoading: false,
      error: null,
    };
    await renderMastery(false);

    // The mastered-share StatRing renders "<pct>%" in its center; 50%, not 43%.
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.queryByText('43%')).toBeNull();
  });

  it('mastered-share is 0% when there are no mastered topics (no divide-by-zero)', async () => {
    mockMasteryState = {
      data: [row('l1', 'beginner'), row('l2', 'developing')],
      isLoading: false,
      error: null,
    };
    await renderMastery(false);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('bucket→colour uses semantic tokens — no unguarded 6-digit brand hex in output', async () => {
    mockMasteryState = {
      data: [row('m1', 'mastered'), row('l1', 'beginner'), row('r1', 'proficient', true)],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(false);

    const styles = inlineStyles(container);
    // Tokens are present …
    expect(styles).toContain('var(--green');
    expect(styles).toContain('var(--accent-warm');
    expect(styles).toContain('var(--purple');
    // … and once var() fallbacks are stripped, no brand hex remains hardcoded.
    expect(stripVarFallbacks(styles)).not.toMatch(SIX_DIGIT_HEX);
  });

  it('renders the os-reveal-card stagger wrapper (Wave 2 reveal, reduced-motion-handled globally)', async () => {
    mockMasteryState = {
      data: [row('m1', 'mastered')],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(false);
    expect(container.querySelector('.os-reveal-card')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BoardScoreWidget — StatRing gauge value mapping + status band (raw fetch seam)
// ─────────────────────────────────────────────────────────────────────────────

// Minimal contract-shaped prediction. The gauge reads predicted_score/max_score
// (summed across subjects); the status band of a chapter reads STATUS_CFG[status].
function prediction(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'p1',
    subject_code: 'science',
    subject_label: 'Science',
    grade: '10',
    score_date: '2026-06-01',
    predicted_score: 60,
    max_score: 80,
    predicted_pct: 75,
    confidence_band_low: 55,
    confidence_band_high: 70,
    chapter_scores: {},
    recovery_plan: [],
    chapters_with_data: 5,
    total_chapters: 10,
    coverage_pct: 50,
    computed_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => payload,
    }),
  );
}

async function renderBoardScore(isHi = false) {
  const { default: BoardScoreWidget } = await import(
    '@/components/dashboard/os/BoardScoreWidget'
  );
  return render(
    React.createElement(BoardScoreWidget, { isHi, studentId: 'stu-1' }),
  );
}

describe('Wave 2 — BoardScoreWidget StatRing gauge value mapping', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('gauge renders the overall predicted % = round(totalPredicted/totalMax*100)', async () => {
    // 60/80 = 75%.
    mockFetchOnce({ code: 'ok', data: [prediction({ predicted_score: 60, max_score: 80 })] });
    await renderBoardScore(false);

    // The gauge value text appears once it has loaded. 75% is also the band
    // threshold (>= 75 → green) so it doubles as the status-band assertion.
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument());
    // Predicted-marks readout = round(totalPredicted) "/" totalMax.
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('/80')).toBeInTheDocument();
  });

  it('StatRing gauge ARIA clamps an out-of-range upstream pct to 0–100', async () => {
    // totalMax 0 forces the widget's fallback to round(predicted_pct); set an
    // out-of-range pct (150) to exercise the clamp.
    mockFetchOnce({
      code: 'ok',
      data: [prediction({ predicted_score: 999, max_score: 0, predicted_pct: 150 })],
    });
    await renderBoardScore(false);

    // The StatRing ring itself (role="img") clamps to 100 — this is the visual
    // gauge geometry, which can never overshoot the ring.
    // NOTE: the widget's caller-supplied CENTER text is `{overallPct}%` and is
    // NOT clamped by the widget, so it would read "150%". The ring geometry +
    // its ARIA value are the clamped, authoritative gauge signal. We assert the
    // clamped ring; documenting the unclamped center as a (cosmetic, non-P1)
    // observation — board-score % is a display-only prediction, not a score.
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute('aria-label', '100%'),
    );
  });

  it('sums marks across multiple subjects for the overall gauge', async () => {
    // (40 + 20) / (50 + 50) = 60/100 = 60%.
    mockFetchOnce({
      code: 'ok',
      data: [
        prediction({ subject_code: 'sci', predicted_score: 40, max_score: 50 }),
        prediction({ subject_code: 'math', predicted_score: 20, max_score: 50 }),
      ],
    });
    await renderBoardScore(false);
    await waitFor(() => expect(screen.getByText('60%')).toBeInTheDocument());
  });

  it('uses semantic tokens for the gauge band — no unguarded 6-digit brand hex', async () => {
    mockFetchOnce({ code: 'ok', data: [prediction()] });
    const { container } = await renderBoardScore(false);
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument());

    const styles = inlineStyles(container);
    // Gauge band at 75% → --green; tints route through --accent-warm-rgb.
    expect(styles).toContain('var(--green');
    expect(stripVarFallbacks(styles)).not.toMatch(SIX_DIGIT_HEX);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RoadmapNode — status→colour token + numeric % unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('Wave 2 — RoadmapNode status→colour tokenization', () => {
  it('needs-revision status uses the --purple token (was #8B5CF6) on the ring stroke', async () => {
    const { RoadmapNode } = await import('@/components/ui/RoadmapNode');
    const { container } = render(
      React.createElement(RoadmapNode, {
        label: 'Algebra',
        percent: 42,
        status: 'needs-revision',
        statusLabel: 'Needs Revision',
      }),
    );
    // The progress ring stroke carries the status colour. It must be the token,
    // never the old literal #8B5CF6.
    const stroke = container.querySelector('circle[stroke-linecap="round"]');
    expect(stroke?.getAttribute('stroke')).toContain('var(--purple');
    expect(stroke?.getAttribute('stroke')).not.toBe('#8B5CF6');
  });

  it('mastered → --green and learning → --accent-warm on the ring stroke', async () => {
    const { RoadmapNode } = await import('@/components/ui/RoadmapNode');

    const { container: mastered } = render(
      React.createElement(RoadmapNode, {
        label: 'Cells',
        percent: 90,
        status: 'mastered',
        statusLabel: 'Mastered',
      }),
    );
    expect(
      mastered.querySelector('circle[stroke-linecap="round"]')?.getAttribute('stroke'),
    ).toContain('var(--green');

    const { container: learning } = render(
      React.createElement(RoadmapNode, {
        label: 'Atoms',
        percent: 30,
        status: 'learning',
        statusLabel: 'Learning',
      }),
    );
    expect(
      learning.querySelector('circle[stroke-linecap="round"]')?.getAttribute('stroke'),
    ).toContain('var(--accent-warm');
  });

  it('numeric % renders unchanged and is clamped/rounded (presentation only, not P1)', async () => {
    const { RoadmapNode } = await import('@/components/ui/RoadmapNode');
    const { container, rerender } = render(
      React.createElement(RoadmapNode, {
        label: 'Topic',
        percent: 73.6,
        status: 'learning',
        statusLabel: 'Learning',
      }),
    );
    // 73.6 rounds to 74.
    expect(container.textContent).toContain('74%');

    // Out-of-range clamps to 0..100.
    rerender(
      React.createElement(RoadmapNode, {
        label: 'Topic',
        percent: 150,
        status: 'mastered',
        statusLabel: 'Mastered',
      }),
    );
    expect(container.textContent).toContain('100%');
  });

  it('border tint uses color-mix on the token (no invalid `${var}33` alpha) — no unguarded brand hex', async () => {
    const { RoadmapNode } = await import('@/components/ui/RoadmapNode');
    const { container } = render(
      React.createElement(RoadmapNode, {
        label: 'Topic',
        percent: 42,
        status: 'needs-revision',
        statusLabel: 'Needs Revision',
      }),
    );
    const styles = inlineStyles(container);
    // The fixed border uses color-mix(in srgb, <token> 22%, transparent).
    expect(styles).toContain('color-mix');
    expect(stripVarFallbacks(styles)).not.toMatch(SIX_DIGIT_HEX);
  });
});
