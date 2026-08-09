/**
 * /parent/reports — a failed read renders an HONEST, retryable error state and
 * is DISTINCT from the genuine empty state (render unit).
 *
 * Frontend audit, Phase 3 Wave B (parent portal).
 *
 *   The monthly-report section collapsed FOUR different outcomes into one
 *   reassuring sentence. `usePortalAction` throws on any non-2xx, and the
 *   parent-portal Edge Function returns:
 *
 *     - 500 { error: 'Failed to load monthly report' }               → throw
 *     - 403 { error: "You do not have access to this child's data." } → throw
 *     - 400 { error: '... are required' }                             → throw
 *     - 200 { error: 'No monthly report available for this period.' } → resolve
 *
 *   Both the `else` branch and the `catch` ran `setMonthlyData(null)`, and the
 *   render keyed the empty copy off `!monthlyData`. So a 500 — and an
 *   access-denied — told a paying parent "No monthly report available for this
 *   period.", which reads as "your child had a quiet month", not "we could not
 *   reach the report". Only the 200-with-error case is genuinely empty.
 *
 *   The performance-score trends had the sibling defect: the PostgREST builder
 *   RESOLVES with { data, error } rather than rejecting, so the try/catch was
 *   dead code and reading `data` alone made a failed read look like "this child
 *   has no performance scores" — the whole section silently vanished.
 *
 *   Both directions are asserted for each surface. A test that only asserted
 *   the failure direction would still pass if the fix had simply deleted the
 *   empty state, and a test that only asserted the empty direction would pass
 *   if the fix had made every empty look like an error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

/* ── Mutable auth state (isHi flips for the bilingual test) ─────────────── */
const { authState } = vi.hoisted(() => ({
  authState: {
    guardian: { id: 'guardian-1', name: 'Parent' },
    authUserId: 'user-1',
    activeRole: 'guardian',
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

/* ── Search params drive which tab mounts ───────────────────────────────── */
const { searchParams } = vi.hoisted(() => ({
  searchParams: { value: new URLSearchParams('tab=monthly') },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/parent/reports',
  useSearchParams: () => searchParams.value,
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/* ── Assert we LOG the failure rather than swallowing it into the void, and
 *    that the log carries a reason ONLY (P13 — no student id, no payload). ── */
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: warnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/* ── Configurable parent-portal stub ─────────────────────────────────────
 * usePortalAction(action, params) => Promise. Per-action behavior is set by
 * each test. Throwing models any non-2xx (500 / 403 / 400 / timeout), which
 * is exactly what the real helper does.
 */
const { portalResults } = vi.hoisted(() => {
  const map = new Map<string, () => Promise<unknown>>();
  // MUST be referentially stable across renders: the page lists `api` in its
  // effect dependency arrays (the real usePortalAction is useCallback-wrapped
  // for exactly this reason). A fresh closure per render re-runs the session
  // effect forever and the page never leaves its skeleton.
  const stableApi = (action: string) => {
    const handler = map.get(action);
    if (!handler) return Promise.resolve({});
    return handler();
  };
  return { portalResults: { map, stableApi } };
});

vi.mock('@alfanumrik/lib/usePortalFetch', () => ({
  usePortalAction: () => portalResults.stableApi,
  usePortalFetch: () => vi.fn(),
  PORTAL_TIMEOUT_MESSAGE_EN: 'Request timed out. Please try again.',
  PORTAL_TIMEOUT_MESSAGE_HI: 'अनुरोध का समय समाप्त हो गया। कृपया पुनः प्रयास करें।',
}));

/* ── Configurable supabase stub ──────────────────────────────────────────
 * Every builder method returns the builder; the builder is thenable so
 * `await supabase.from(..).select(..).eq(..)` resolves with the configured
 * { data, error } — mirroring PostgREST, which RESOLVES rather than rejects.
 */
const { tableResults } = vi.hoisted(() => ({
  tableResults: {
    map: new Map<string, { data: unknown; error: unknown }>(),
  },
}));

vi.mock('@alfanumrik/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const result = () =>
      tableResults.map.get(table) ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const m of [
      'select', 'eq', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'limit',
      'neq', 'is', 'not', 'filter', 'range', 'contains', 'update', 'insert',
    ]) {
      builder[m] = () => builder;
    }
    builder.single = () => Promise.resolve(result());
    builder.maybeSingle = () => Promise.resolve(result());
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt' } } }),
      },
    },
    getFeatureFlags: () => Promise.resolve({}),
  };
});

vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => ({ data: {} }),
}));

/* Heavy/irrelevant children — the assertions are about error vs empty gating. */
vi.mock('@alfanumrik/ui/parent/ParentLabReportWidget', () => ({ default: () => null }));
vi.mock('@alfanumrik/ui/parent/ConversationPromptsCard', () => ({
  ConversationPromptsCard: () => null,
}));

import ParentReportsPage from '@/app/parent/reports/page';

/* ── Copy under test (verbatim from the page) ───────────────────────────── */
const EMPTY_EN = 'No monthly report available for this period.';
const EMPTY_HI = 'इस अवधि के लिए कोई मासिक रिपोर्ट उपलब्ध नहीं है।';
const FAIL_EN = "We couldn't load this month's report.";
const FAIL_HI = 'इस महीने की रिपोर्ट लोड नहीं हो सकी।';
const TRENDS_FAIL_EN = "Performance scores couldn't be loaded.";

const CHILD = { id: 'child-1', name: 'Aarav', grade: '8' };

function setPortal(action: string, handler: () => Promise<unknown>) {
  portalResults.map.set(action, handler);
}

beforeEach(() => {
  vi.clearAllMocks();
  portalResults.map.clear();
  tableResults.map.clear();
  authState.isHi = false;
  searchParams.value = new URLSearchParams('tab=monthly');
  // Guardian resolves to exactly one linked child by default.
  setPortal('get_children', () => Promise.resolve({ children: [CHILD] }));
  setPortal('get_child_dashboard', () => Promise.resolve({ stats: {} }));
});

afterEach(() => cleanup());

describe('/parent/reports — monthly report: failure is not "no report"', () => {
  it('a FAILED monthly-report read shows an honest error + retry, NOT the reassuring empty copy', async () => {
    // Models the real 500 / 403 / 400 / timeout paths, all of which throw
    // through usePortalAction.
    setPortal('get_monthly_report', () =>
      Promise.reject(new Error('API error 500: Failed to load monthly report')),
    );

    render(<ParentReportsPage />);

    expect(await screen.findByText(FAIL_EN)).toBeTruthy();
    // The lie must be gone.
    expect(screen.queryByText(EMPTY_EN)).toBeNull();
    // and it must be recoverable
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('an access-denied (403) is ALSO surfaced as a failure, never as "no report"', async () => {
    setPortal('get_monthly_report', () =>
      Promise.reject(new Error("API error 403: You do not have access to this child's data.")),
    );

    render(<ParentReportsPage />);

    expect(await screen.findByText(FAIL_EN)).toBeTruthy();
    expect(screen.queryByText(EMPTY_EN)).toBeNull();
  });

  it('a GENUINELY empty month (HTTP 200 + {error}) shows the empty copy and NO error card', async () => {
    // This is the one path the Edge Function returns with status 200.
    setPortal('get_monthly_report', () =>
      Promise.resolve({ error: 'No monthly report available for this period.' }),
    );

    render(<ParentReportsPage />);

    expect(await screen.findByText(EMPTY_EN)).toBeTruthy();
    expect(screen.queryByText(FAIL_EN)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a successful report renders neither the empty copy nor the error copy', async () => {
    setPortal('get_monthly_report', () =>
      Promise.resolve({ report_data: { conceptMasteryPct: 72, retentionScore: 60 } }),
    );

    render(<ParentReportsPage />);

    await waitFor(() => {
      expect(screen.queryByText(EMPTY_EN)).toBeNull();
    });
    expect(screen.queryByText(FAIL_EN)).toBeNull();
  });

  it('logs the failure with a reason only — no student id, name, or payload (P13)', async () => {
    setPortal('get_monthly_report', () =>
      Promise.reject(new Error('API error 500: Failed to load monthly report')),
    );

    render(<ParentReportsPage />);
    await screen.findByText(FAIL_EN);

    const call = warnSpy.mock.calls.find((c) => c[0] === 'parent.monthly_report.load_failed');
    expect(call).toBeTruthy();
    const meta = JSON.stringify(call?.[1] ?? {});
    expect(Object.keys(call?.[1] ?? {})).toEqual(['reason']);
    expect(meta).not.toContain(CHILD.id);
    expect(meta).not.toContain(CHILD.name);
  });

  it('the failure copy is bilingual (P7)', async () => {
    authState.isHi = true;
    setPortal('get_monthly_report', () => Promise.reject(new Error('boom')));

    render(<ParentReportsPage />);

    expect(await screen.findByText(FAIL_HI)).toBeTruthy();
    expect(screen.queryByText(FAIL_EN)).toBeNull();
  });

  it('the genuine-empty copy is bilingual (P7)', async () => {
    authState.isHi = true;
    setPortal('get_monthly_report', () =>
      Promise.resolve({ error: 'No monthly report available for this period.' }),
    );

    render(<ParentReportsPage />);

    expect(await screen.findByText(EMPTY_HI)).toBeTruthy();
    expect(screen.queryByText(FAIL_HI)).toBeNull();
  });

  it('retry recovers: a failure followed by a successful retry clears the error', async () => {
    let attempt = 0;
    setPortal('get_monthly_report', () => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('API error 500'))
        : Promise.resolve({ report_data: { conceptMasteryPct: 55 } });
    });

    render(<ParentReportsPage />);
    const retry = await screen.findByRole('button', { name: /try again/i });

    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.queryByText(FAIL_EN)).toBeNull();
    });
    // Recovering into data must not fall through to the empty claim either.
    expect(screen.queryByText(EMPTY_EN)).toBeNull();
  });
});

describe('/parent/reports — performance-score trends: failure is not "no scores"', () => {
  beforeEach(() => {
    searchParams.value = new URLSearchParams(); // weekly view
    setPortal('get_child_dashboard', () =>
      Promise.resolve({ stats: { accuracy: 70 }, subjects: [] }),
    );
  });

  it('a FAILED performance_scores read surfaces an error instead of silently hiding the section', async () => {
    // PostgREST RESOLVES with an error — it does not reject. The old code read
    // `data` only, so this looked exactly like "no scores".
    tableResults.map.set('performance_scores', {
      data: null,
      error: { message: 'permission denied for table performance_scores' },
    });

    render(<ParentReportsPage />);

    expect(await screen.findByText(TRENDS_FAIL_EN)).toBeTruthy();

    const call = warnSpy.mock.calls.find(
      (c) => c[0] === 'parent.report.performance_scores_failed',
    );
    expect(call).toBeTruthy();
    expect(Object.keys(call?.[1] ?? {})).toEqual(['reason']);
  });

  it('a genuinely EMPTY performance_scores read shows no error card', async () => {
    tableResults.map.set('performance_scores', { data: [], error: null });

    render(<ParentReportsPage />);

    await waitFor(() => {
      expect(screen.queryByText(TRENDS_FAIL_EN)).toBeNull();
    });
  });

  it('a FAILED score_history read degrades honestly rather than claiming "No data from last week"', async () => {
    tableResults.map.set('performance_scores', {
      data: [{ subject: 'Math', overall_score: 70, level_name: 'Proficient' }],
      error: null,
    });
    tableResults.map.set('score_history', {
      data: null,
      error: { message: 'permission denied for table score_history' },
    });

    render(<ParentReportsPage />);

    expect(await screen.findByText(TRENDS_FAIL_EN)).toBeTruthy();
    // The per-subject "no previous data" claim must not be rendered off a
    // failed read.
    expect(screen.queryByText('No data from last week')).toBeNull();

    const call = warnSpy.mock.calls.find((c) => c[0] === 'parent.report.score_history_failed');
    expect(call).toBeTruthy();
    expect(Object.keys(call?.[1] ?? {})).toEqual(['reason']);
  });
});
