/**
 * /hpc — the NEP 2020 Holistic Progress Card may not assert facts it lacks
 * (Phase 6 / Risk R4).
 *
 * Two fabrications sat in the card header, the most official-looking surface
 * a student or parent sees:
 *
 *   `P{String(hpc.class_percentile || 50)}` under the label "Class percentile"
 *      → EVERY student for whom the backend returned no percentile was told,
 *        in 36px type, that they are exactly median. The `||` also swallowed a
 *        genuine 0th percentile and reported it as the 50th.
 *
 *   `{String(stu?.board || 'CBSE')}`
 *      → the card asserted a board affiliation for a student whose board was
 *        never recorded.
 *
 * Rule: omit, don't invent. No percentile → say so; no board → print nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const { authState, hpcPayload } = vi.hoisted(() => ({
  authState: {
    student: { id: 'stu-1', name: 'Asha' },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
  hpcPayload: { current: {} as Record<string, unknown> },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => authState }));

/* The real `usePortalAction` returns a useCallback-stable function; the mock
 * must too, or the page's `useEffect([nepApi])` re-fires on every render and
 * the card never leaves its loading state. */
const stableNepApi = async (action: string) =>
  action === 'get_hpc' ? hpcPayload.current : { ok: true };

vi.mock('@alfanumrik/lib/usePortalFetch', () => ({
  usePortalAction: () => stableNepApi,
}));

// The Wave 3 synthesis chip is irrelevant here.
const originalFetch = globalThis.fetch;

import HPCPage from '@/app/hpc/page';

function baseHpc(extra: Record<string, unknown> = {}) {
  return {
    student: { name: 'Asha', grade: '10' },
    academic_year: '2026-27',
    term: 'Term 1',
    bloom_distribution: { total: 0 },
    subject_performance: {},
    competency_levels: {},
    learning_behaviors: {},
    holistic_indicators: {},
    cbse_readiness: {},
    portfolio_highlights: [],
    generated_at: new Date().toISOString(),
    ...extra,
  };
}

beforeEach(() => {
  authState.isHi = false;
  globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  hpcPayload.current = baseHpc();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe('/hpc — class percentile', () => {
  it('does not print P50 when the backend supplied no percentile', async () => {
    hpcPayload.current = baseHpc(); // no class_percentile key at all
    render(<HPCPage />);

    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.queryByText('P50')).toBeNull();
    expect(screen.getByTestId('class-percentile-unavailable')).toBeTruthy();
  });

  it('prints a real 0th percentile as P0 rather than swallowing it into P50', async () => {
    hpcPayload.current = baseHpc({ class_percentile: 0 });
    render(<HPCPage />);

    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.getByText('P0')).toBeTruthy();
    expect(screen.queryByText('P50')).toBeNull();
  });

  it('prints a real percentile when the backend supplies one', async () => {
    hpcPayload.current = baseHpc({ class_percentile: 72 });
    render(<HPCPage />);

    await waitFor(() => expect(screen.getByText('P72')).toBeTruthy());
    expect(screen.queryByTestId('class-percentile-unavailable')).toBeNull();
  });

  it('states the missing-percentile case in Hindi under isHi (P7)', async () => {
    authState.isHi = true;
    hpcPayload.current = baseHpc();
    render(<HPCPage />);

    await waitFor(() => expect(screen.getByTestId('class-percentile-unavailable')).toBeTruthy());
    expect(screen.getByTestId('class-percentile-unavailable').textContent).toMatch(/[ऀ-ॿ]/);
  });
});

describe('/hpc — board affiliation', () => {
  it('does not assert CBSE for a student with no recorded board', async () => {
    hpcPayload.current = baseHpc({ student: { name: 'Asha', grade: '10' } });
    render(<HPCPage />);

    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.getByTestId('hpc-identity').textContent).not.toContain('CBSE');
  });

  it('prints the board when one is actually recorded', async () => {
    hpcPayload.current = baseHpc({ student: { name: 'Asha', grade: '10', board: 'CBSE' } });
    render(<HPCPage />);

    await waitFor(() => expect(screen.getByTestId('hpc-identity')).toBeTruthy());
    expect(screen.getByTestId('hpc-identity').textContent).toContain('CBSE');
  });

  it('omits the grade segment entirely rather than printing a bare "Grade"', async () => {
    hpcPayload.current = baseHpc({ student: { name: 'Asha' } });
    render(<HPCPage />);

    await waitFor(() => expect(screen.getByTestId('hpc-identity')).toBeTruthy());
    expect(screen.getByTestId('hpc-identity').textContent).not.toMatch(/Grade\s*(\||$)/);
  });
});
