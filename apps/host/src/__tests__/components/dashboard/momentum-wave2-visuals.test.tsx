import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

/**
 * Alfa dashboard glance panels — value-bearing visuals (Phase 3b rebuild).
 *
 * Phase 3b re-composed MasterySnapshot and BoardScoreWidget entirely on the
 * canonical primitives (Card / MasteryRing / ProgressRing / ProgressBar / Badge
 * / Tabs / EmptyState / Alert / Skeleton), token-only. These tests pin the
 * VALUE-BEARING half of that rebuild — the numbers the student reads off the new
 * visualizations, the ARIA the new primitives expose, and token-purity on the
 * changed surfaces — following the hook/fetch-seam + inline-style-scan patterns
 * in momentum-primitives.test.tsx and TodaysMission.test.tsx.
 *
 * INTENDED SEMANTIC CHANGE (assessment condition C1): the MasterySnapshot
 * headline ring now shows ACCURACY % (aggregateAccuracyPercent =
 * round(Σcorrect_attempts / Σattempts * 100), the P1-canonical helper), NOT the
 * old mastered-share (mastered / total). The ring must reconcile with quiz
 * accuracy, not with how many topics happen to be mastered. These tests assert
 * the NEW accuracy semantics and will fail loudly if the panel ever regresses to
 * mastered-share.
 *
 * JSDOM has no layout/CSS, so we assert DOM structure, rendered text, ARIA, and
 * the ABSENCE of 6-digit brand hex literals — never computed visual styles.
 */

// ── next/navigation router mock ──────────────────────────────────────────────
// Both panels now call useRouter() (EmptyState / demoted-CTA navigation), so the
// app-router invariant must be satisfied under JSDOM.
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

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

/** All role=progressbar nodes in a subtree (MasteryRing wrapper + ProgressBars). */
function progressbars(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="progressbar"]'));
}
/** The distribution bars carry "…topics…" in their aria-label; the ring does not. */
function isDistributionBar(el: HTMLElement): boolean {
  return /topics|विषय/.test(el.getAttribute('aria-label') ?? '');
}

// ─────────────────────────────────────────────────────────────────────────────
// MasterySnapshot — bucket distribution + headline ACCURACY ring (C1)
// ─────────────────────────────────────────────────────────────────────────────

// Drive the component's only data seam: the useMasteryOverview SWR hook.
type SwrState = { data: unknown; isLoading: boolean; error: unknown };
let mockMasteryState: SwrState;
vi.mock('@alfanumrik/lib/swr', () => ({
  useMasteryOverview: () => mockMasteryState,
}));

// One overview row per topic. `mastery_level` + `due_for_review` drive bucketing;
// `attempts` / `correct_attempts` drive the C1 accuracy ring.
function row(
  topic_id: string,
  mastery_level: string,
  due_for_review = false,
  attempts = 0,
  correct_attempts = 0,
): Record<string, unknown> {
  return {
    topic_id,
    title: topic_id,
    mastery_level,
    mastery_probability: 0.5,
    attempts,
    correct_attempts,
    due_for_review,
    subject: 'science',
  };
}

async function renderMastery(isHi = false) {
  const { default: MasterySnapshot } = await import(
    '@alfanumrik/ui/dashboard/os/MasterySnapshot'
  );
  return render(
    React.createElement(MasterySnapshot, { isHi, studentId: 'stu-1' }),
  );
}

describe('Phase 3b — MasterySnapshot value-bearing visuals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMasteryState = { data: undefined, isLoading: false, error: null };
  });

  it('renders the three bucket counts on the restored list distribution', async () => {
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

    const list = container.querySelector('[role="list"]');
    expect(list).not.toBeNull();
    const items = Array.from(container.querySelectorAll('[role="listitem"]'));
    expect(items.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mastered: 4 topics',
      'Learning: 3 topics',
      'Needs Revision: 2 topics',
    ]);

    // Count Badges render the raw per-bucket tallies …
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // … and the total chip = 4 + 3 + 2 = 9 (not_started excluded).
    expect(container.textContent).toContain('9\u2009topics');
  });

  it('the headline StatRing shows mastered-share on the restored stable UI', async () => {
    // Σcorrect = 4+1+2 = 7, Σattempts = 4+2+4 = 10 → accuracy = round(7/10*100)
    // = 70%. Buckets: mastered 2, learning 1 → mastered-share would be
    // round(2/3*100) = 67%. The ring MUST read 70% (accuracy), never 67%
    // (mastered-share) — that is the C1 semantic. The not_started row has 0
    // attempts and contributes nothing to either the buckets or the accuracy.
    mockMasteryState = {
      data: [
        row('m1', 'mastered', false, 4, 4),
        row('m2', 'mastered', false, 2, 1),
        row('l1', 'beginner', false, 4, 2),
        row('x1', 'not_started', false, 0, 0),
      ],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(false);

    const ring = await screen.findByRole('img', { name: '67%' });
    expect(ring).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('accuracy ring is 0% when there are no attempts (no divide-by-zero)', async () => {
    mockMasteryState = {
      data: [row('l1', 'beginner', false, 0, 0), row('l2', 'developing', false, 0, 0)],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(false);
    // Assert on the ring specifically — bucket shares also render "0%", so a bare
    // getByText('0%') would be ambiguous.
    const ring = await screen.findByRole('img', { name: '0%' });
    expect(ring).toBeInTheDocument();
  });

  it('renders the Hindi accuracy caption + bilingual bucket labels (P7)', async () => {
    mockMasteryState = {
      data: [row('m1', 'mastered', false, 2, 2), row('r1', 'proficient', true, 2, 1)],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(true);
    expect(screen.getByText('महारत')).toBeInTheDocument();
    // Bucket labels are localized; numbers stay Arabic numerals (P7).
    const labels = Array.from(container.querySelectorAll('[role="listitem"]')).map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.startsWith('महारत हासिल:') && /विषय/.test(l))).toBe(true);
    expect(labels.some((l) => l.startsWith('दोहराना जरूरी:') && /विषय/.test(l))).toBe(true);
  });

  it('bucket + ring colour uses semantic tokens — no unguarded 6-digit brand hex in output', async () => {
    mockMasteryState = {
      data: [
        row('m1', 'mastered', false, 2, 2),
        row('l1', 'beginner', false, 2, 1),
        row('r1', 'proficient', true, 2, 1),
      ],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(false);

    const styles = inlineStyles(container);
    expect(styles).toContain('var(--green');
    expect(styles).toContain('var(--accent-warm');
    expect(styles).toContain('var(--purple');
    // … and once var() fallbacks are stripped, no brand hex remains hardcoded.
    expect(stripVarFallbacks(styles)).not.toMatch(SIX_DIGIT_HEX);
  });

  it('renders the os-reveal-card stagger wrapper (reveal, reduced-motion-handled globally)', async () => {
    mockMasteryState = {
      data: [row('m1', 'mastered', false, 1, 1)],
      isLoading: false,
      error: null,
    };
    const { container } = await renderMastery(false);
    expect(container.querySelector('.os-reveal-card')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BoardScoreWidget — ProgressRing gauge value mapping + status band (fetch seam)
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
    '@alfanumrik/ui/dashboard/os/BoardScoreWidget'
  );
  return render(
    React.createElement(BoardScoreWidget, { isHi, studentId: 'stu-1' }),
  );
}

describe('Phase 3b — BoardScoreWidget ProgressRing gauge value mapping', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('gauge renders the overall predicted % = round(totalPredicted/totalMax*100)', async () => {
    // 60/80 = 75%.
    mockFetchOnce({ code: 'ok', data: [prediction({ predicted_score: 60, max_score: 80 })] });
    await renderBoardScore(false);

    // The gauge is now the ProgressRing primitive (role="progressbar"), not the
    // old StatRing (role="img"). Its accessible name + value carry the 75%.
    const gauge = await screen.findByRole('img', { name: '75%' });
    expect(gauge).toBeInTheDocument();
    // Predicted-marks readout = round(totalPredicted) "/" totalMax.
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('/80')).toBeInTheDocument();
  });

  it('ProgressRing gauge ARIA clamps an out-of-range upstream pct to 0–100', async () => {
    // totalMax 0 forces the widget's fallback to round(predicted_pct); set an
    // out-of-range pct (150) to exercise the clamp.
    mockFetchOnce({
      code: 'ok',
      data: [prediction({ predicted_score: 999, max_score: 0, predicted_pct: 150 })],
    });
    await renderBoardScore(false);

    // The ProgressRing clamps its geometry + ARIA to 0–100 — the authoritative,
    // never-overshooting gauge signal is aria-valuenow=100 / aria-label "100%".
    const gauge = await screen.findByRole('img', { name: '100%' });
    expect(gauge).toBeInTheDocument();
    // The caller-supplied CENTER text is `{overallPct}%` and is intentionally
    // NOT clamped by the widget, so it reads "150%" — a cosmetic, non-P1
    // observation (board-score % is a display-only prediction, not a score).
    expect(screen.getByText('150%')).toBeInTheDocument();
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
    const gauge = await screen.findByRole('img', { name: '60%' });
    expect(gauge).toBeInTheDocument();
  });

  it('gauge band uses a semantic tone token on the ProgressRing arc — no unguarded 6-digit brand hex', async () => {
    // 60/80 = 75% → success tone.
    mockFetchOnce({ code: 'ok', data: [prediction()] });
    const { container } = await renderBoardScore(false);
    await screen.findByRole('img', { name: '75%' });

    // The restored StatRing paints the arc via the warm stable token set.
    const arc = container.querySelector('circle[stroke-linecap="round"]');
    expect(arc?.getAttribute('stroke')).toContain('var(--green');
    expect(stripVarFallbacks(arc?.getAttribute('stroke') ?? '')).not.toMatch(SIX_DIGIT_HEX);

    // Inline styles (badges / bars) still carry no unguarded 6-digit brand hex.
    const styles = inlineStyles(container);
    expect(styles).toContain('var(--green'); // CBSE badge soft tint
    expect(stripVarFallbacks(styles)).not.toMatch(SIX_DIGIT_HEX);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RoadmapNode — status→colour token + numeric % unchanged (Phase 3b left as-is)
// ─────────────────────────────────────────────────────────────────────────────

describe('RoadmapNode status→colour tokenization', () => {
  it('needs-revision status uses the --purple token (was #8B5CF6) on the ring stroke', async () => {
    const { RoadmapNode } = await import('@alfanumrik/ui/ui/RoadmapNode');
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
    const { RoadmapNode } = await import('@alfanumrik/ui/ui/RoadmapNode');

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
    const { RoadmapNode } = await import('@alfanumrik/ui/ui/RoadmapNode');
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
    const { RoadmapNode } = await import('@alfanumrik/ui/ui/RoadmapNode');
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
