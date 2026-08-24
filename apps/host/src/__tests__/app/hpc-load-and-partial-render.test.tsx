/**
 * /hpc — the NEP 2020 Holistic Progress Card must actually LOAD, and a partial
 * backend answer must still produce a card (CEO defect #12).
 *
 * WHAT WAS BROKEN (measured 2026-08-24)
 *   1. The page fired `generate_hpc` and THEN `get_hpc`. Both actions run the
 *      same `generateHPC()` fan-out in the nep-compliance Edge Function, and
 *      `generate_hpc` persists nothing (`// TODO: Store generated HPC in a
 *      nep_hpc_reports table for caching`), so every view paid for the whole
 *      multi-table computation twice.
 *   2. `usePortalFetch` defaults `timeoutMs` to 10000 and the page never
 *      overrode it, so the doubled work aborted → caught → red
 *      "Failed to load HPC".
 *   3. `if (!hpc || hpc.error)` replaced the ENTIRE card with that red line, so
 *      one missing sub-read blanked everything.
 *
 * This suite pins all three at the page's own seams: the portal-action call
 * log (how many calls, which actions, and the timeout argument) and the
 * rendered section set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const { authState, api } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', name: 'Asha' } as { id: string; name: string } | null,
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
  api: {
    calls: [] as string[],
    timeoutMs: undefined as number | undefined,
    /** action → response (or thrower). */
    handler: (async () => ({})) as (action: string) => Promise<unknown>,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

/* The real `usePortalAction` returns a useCallback-stable function; the mock
 * must too, or the page's `useEffect([nepApi])` re-fires forever. We also
 * capture the third argument — the timeout budget the page passes. */
const stableApi = async (action: string) => {
  api.calls.push(action);
  return api.handler(action);
};
vi.mock('@alfanumrik/lib/usePortalFetch', () => ({
  usePortalAction: (_endpoint: string, _isHi: boolean, timeoutMs?: number) => {
    api.timeoutMs = timeoutMs;
    return stableApi;
  },
}));

const originalFetch = globalThis.fetch;

import HPCPage from '@/app/hpc/page';

function fullReport(extra: Record<string, unknown> = {}) {
  return {
    student: { name: 'Asha', grade: '10' },
    academic_year: '2026-27',
    term: 'Term 1',
    bloom_distribution: { remember: 4, understand: 2, total: 6 },
    subject_performance: {
      science: { avg_mastery_pct: 62, concepts_attempted: 12, concepts_total: 40, chapters_covered: 3, chapters_total: 13 },
    },
    competency_levels: { science: { overall_level: 'developing' } },
    learning_behaviors: { consistency: 3, curiosity: 4, self_regulation: 2, collaboration: 1 },
    holistic_indicators: { total_sessions: 9, active_days: 5, streak_best: 3, notes_created: 0, xp_total: 340, study_regularity_pct: 41 },
    cbse_readiness: {},
    portfolio_highlights: [],
    generated_at: '2026-08-24T00:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => {
  authState.isHi = false;
  authState.student = { id: 'stu-1', name: 'Asha' };
  api.calls = [];
  api.timeoutMs = undefined;
  api.handler = async () => fullReport();
  globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('/hpc — the double compute is gone', () => {
  it('issues get_hpc ONLY when the first read already returns a report', async () => {
    api.handler = async () => fullReport();

    render(<HPCPage />);
    await waitFor(() => expect(screen.getByTestId('hpc-section-bloom')).toBeTruthy());

    expect(api.calls).toEqual(['get_hpc']);
    expect(api.calls).not.toContain('generate_hpc');
  });

  it('falls back to generate_hpc + a re-read ONLY when get_hpc returns nothing', async () => {
    let served = 0;
    api.handler = async (action: string) => {
      if (action === 'generate_hpc') return { success: true, generated: true };
      served += 1;
      return served === 1 ? {} : fullReport(); // first read empty, second has data
    };

    render(<HPCPage />);
    await waitFor(() => expect(screen.getByTestId('hpc-section-bloom')).toBeTruthy());

    expect(api.calls).toEqual(['get_hpc', 'generate_hpc', 'get_hpc']);
  });

  it('passes a timeout budget well above usePortalFetch\'s 10s default', async () => {
    render(<HPCPage />);
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));

    expect(api.timeoutMs).toBeDefined();
    expect(api.timeoutMs as number).toBeGreaterThanOrEqual(30_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('/hpc — a partial payload still renders a card', () => {
  it('a missing bloom_distribution sub-read does not blank the other sections', async () => {
    api.handler = async () => {
      const r = fullReport() as Record<string, unknown>;
      delete r.bloom_distribution; // one sub-read failed upstream
      return r;
    };

    render(<HPCPage />);

    // The other sections still paint …
    await waitFor(() => expect(screen.getByTestId('hpc-section-subjects')).toBeTruthy());
    expect(screen.getByTestId('hpc-section-behaviors')).toBeTruthy();
    expect(screen.getByTestId('hpc-section-holistic')).toBeTruthy();
    // … and the failed one says so, in its own place, without an error.
    expect(screen.getByTestId('hpc-empty-bloom')).toBeTruthy();
    expect(screen.queryByTestId('hpc-error')).toBeNull();
  });

  it('a payload carrying ONLY subject performance still renders that section', async () => {
    api.handler = async () => ({
      subject_performance: {
        maths: { avg_mastery_pct: 71, concepts_attempted: 8, concepts_total: 30, chapters_covered: 2, chapters_total: 14 },
      },
    });

    render(<HPCPage />);

    await waitFor(() => expect(screen.getByTestId('hpc-section-subjects')).toBeTruthy());
    expect(screen.getByTestId('hpc-empty-bloom')).toBeTruthy();
    expect(screen.getByTestId('hpc-empty-behaviors')).toBeTruthy();
    expect(screen.queryByTestId('hpc-error')).toBeNull();
    expect(screen.queryByTestId('hpc-empty')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('/hpc — loading, error and empty are three DISTINCT states', () => {
  it('a thrown/timed-out read renders the ERROR state with a retry, never an empty state', async () => {
    api.handler = async () => { throw new Error('Request timed out. Please try again.'); };

    render(<HPCPage />);

    await waitFor(() => expect(screen.getByTestId('hpc-error')).toBeTruthy());
    expect(screen.getByTestId('hpc-retry')).toBeTruthy();
    expect(screen.queryByTestId('hpc-empty')).toBeNull();
    expect(screen.queryByTestId('hpc-loading')).toBeNull();
  });

  it('a backend {error} envelope renders the ERROR state, never the empty state', async () => {
    api.handler = async () => ({ error: 'Failed to fetch student: connection reset' });

    render(<HPCPage />);

    await waitFor(() => expect(screen.getByTestId('hpc-error')).toBeTruthy());
    expect(screen.queryByTestId('hpc-empty')).toBeNull();
  });

  it('does not leak the raw backend error string to the student', async () => {
    api.handler = async () => ({ error: 'Failed to fetch student: connection reset' });

    render(<HPCPage />);

    const box = await screen.findByTestId('hpc-error');
    expect(box.textContent).not.toContain('connection reset');
  });

  it('a genuinely empty (but successful) answer renders the EMPTY state, never the error state', async () => {
    api.handler = async (action: string) => (action === 'generate_hpc' ? { success: true } : {});

    render(<HPCPage />);

    await waitFor(() => expect(screen.getByTestId('hpc-empty')).toBeTruthy());
    expect(screen.queryByTestId('hpc-error')).toBeNull();
  });

  it('shows the loading state first', () => {
    api.handler = () => new Promise(() => { /* never resolves */ });

    render(<HPCPage />);

    expect(screen.getByTestId('hpc-loading')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('/hpc — P7', () => {
  it('renders the error state in Hindi under isHi', async () => {
    authState.isHi = true;
    api.handler = async () => { throw new Error('boom'); };

    render(<HPCPage />);

    const box = await screen.findByTestId('hpc-error');
    expect(box.textContent).toMatch(/[ऀ-ॿ]/);
  });

  it('renders a per-section empty state in Hindi under isHi', async () => {
    authState.isHi = true;
    api.handler = async () => ({ student: { name: 'Asha', grade: '10' } });

    render(<HPCPage />);

    const box = await screen.findByTestId('hpc-empty-bloom');
    expect(box.textContent).toMatch(/[ऀ-ॿ]/);
  });
});
