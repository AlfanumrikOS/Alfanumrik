/**
 * Super-admin — failure-as-empty regression suite (Wave D, ops lane).
 *
 * THE DEFECT CLASS
 * ----------------
 * `fetch` only rejects on a network fault; a 4xx/5xx RESOLVES. The super-admin
 * pages that wrote `if (res.ok) { …setRows(json.data ?? []) }` with a bare
 * `catch {}` therefore rendered a FAILED read with exactly the pixels of a
 * SUCCESSFUL empty one. On the operational surfaces that is not a cosmetic bug:
 * the empty state of an ops dashboard is an assertion that nothing is wrong.
 *
 * What was actually shipping before this suite:
 *   /super-admin/invoices    → "Total Revenue ₹0" + "No invoices found"
 *   /super-admin/health      → "0 total schools, 0 active in last 7d"
 *                              + "No schools onboarded yet"
 *   /super-admin/subjects/violations
 *                            → "0 violations matching filters"
 *                              + "No violations under the current filters."
 *   /super-admin/subscribers → "No subscribers registered."
 *   /super-admin/subscriptions → the entire revenue KPI block silently vanished
 *   observability SystemSnapshot → "Loading snapshot…" forever, no retry
 *
 * EVERY test here asserts BOTH DIRECTIONS, because the fix is worthless if it
 * merely suppresses zeros:
 *   (a) read FAILED  → honest failure surface, no reassuring copy, no count
 *   (b) read SUCCEEDED and was genuinely empty → the real 0 and the real
 *       "nothing here" copy still render, unchanged.
 * A genuine 0 must stay a 0. That distinction is the entire point.
 *
 * Harness: extends the seams established by analytics-page-error-state.test.tsx
 * — AdminShell (session/context host, so `useAdmin().apiFetch` is a controllable
 * network seam) and AuthContext (bilingual flag). No business logic is mocked;
 * the real page components, real fetch effects and real render branches run.
 *
 * Owning agent: ops.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// ── Controllable network seam ────────────────────────────────────────────────
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

// AdminShell host: pass children through, hand pages our controlled apiFetch.
// `readAdminJson` is stubbed to a plain body read — the branches under test are
// driven by `res.ok`, not by the real non-JSON guard (which has its own suite in
// admin-shell-api-error-contract.test.ts).
vi.mock('@/app/super-admin/_components/AdminShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdmin: () => ({ apiFetch }),
  readAdminJson: async (res: Response) => res.json(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => ({ isHi: false }) }));
vi.mock('@alfanumrik/lib/posthog/client', () => ({ track: vi.fn() }));

import InvoicesPage from '@/app/super-admin/invoices/page';
import HealthPage from '@/app/super-admin/health/page';
import ViolationsPage from '@/app/super-admin/subjects/violations/page';
import SubscribersPage from '@/app/super-admin/subscribers/page';
import SystemSnapshot from '@/app/super-admin/observability/_components/SystemSnapshot';

/** Minimal Response double: only what the pages actually touch. */
function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => apiFetch.mockReset());
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════
   /super-admin/invoices — money. The worst place in the product to render a
   confident ₹0 over a query that never returned.
   ══════════════════════════════════════════════════════════════════════════ */
describe('/super-admin/invoices — failed read never renders ₹0 or "No invoices found"', () => {
  it('(a) FAILED read: em-dash KPIs, retryable alert, and NO "No invoices found"', async () => {
    apiFetch.mockResolvedValue(jsonRes({ error: 'boom' }, 500));
    render(<InvoicesPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // The reassuring empty-state copy must be gone entirely.
    expect(screen.queryByText('No invoices found')).toBeNull();
    // ...and every derived KPI degrades to an em-dash rather than 0 / ₹0.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('₹0')).toBeNull();
    // Recovery path exists.
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('(b) GENUINE EMPTY: real 0 / ₹0 and the real "No invoices found" still render', async () => {
    apiFetch.mockResolvedValue(
      jsonRes({ data: { invoices: [], pagination: { total: 0 } } }),
    );
    render(<InvoicesPage />);

    await waitFor(() => expect(screen.getByText('No invoices found')).toBeTruthy());

    // A genuinely empty invoice book is still allowed to say zero.
    expect(screen.getByText('₹0')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(3);
    // No failure surface on the success path.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('(c) Retry re-issues the failed read', async () => {
    apiFetch.mockResolvedValue(jsonRes({ error: 'boom' }, 500));
    render(<InvoicesPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    const before = apiFetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(before));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /super-admin/health — pilot triage. "0 total schools" after a 500 tells an
   operator the platform is idle when it is actually unreadable.
   ══════════════════════════════════════════════════════════════════════════ */
describe('/super-admin/health — failed read never claims "No schools onboarded yet"', () => {
  it('(a) FAILED read: em-dash counts, honest alert, NO onboarding copy', async () => {
    apiFetch.mockResolvedValue(jsonRes({ error: 'boom' }, 503));
    render(<HealthPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.queryByText('No schools onboarded yet')).toBeNull();
    // Both summary counts degrade together.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('(b) GENUINE EMPTY: real 0 counts and the real onboarding copy still render', async () => {
    apiFetch.mockResolvedValue(
      jsonRes({ schools: [], synthetic_monitor_degraded: false, errors_24h_degraded: false }),
    );
    render(<HealthPage />);

    await waitFor(() => expect(screen.getByText('No schools onboarded yet')).toBeTruthy());

    // A deployment with genuinely no schools still reports 0, not an em-dash.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /super-admin/subjects/violations — compliance. "0 violations" is an
   all-clear on a screen whose only job is to surface invalid enrolments.
   ══════════════════════════════════════════════════════════════════════════ */
describe('/super-admin/subjects/violations — failed read never asserts "0 violations"', () => {
  it('(a) FAILED read: em-dash count, and the "no violations" copy is suppressed', async () => {
    apiFetch.mockResolvedValue(jsonRes({ error: 'boom' }, 500));
    render(<ViolationsPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.queryByText('No violations under the current filters.')).toBeNull();
    expect(screen.queryByText(/0 violations matching filters/)).toBeNull();
    expect(screen.getByText(/— violations matching filters \(read failed\)/)).toBeTruthy();
  });

  it('(b) GENUINE EMPTY: "0 violations matching filters" and the empty copy still render', async () => {
    apiFetch.mockResolvedValue(jsonRes({ data: [], total: 0 }));
    render(<ViolationsPage />);

    await waitFor(() =>
      expect(screen.getByText('No violations under the current filters.')).toBeTruthy(),
    );

    // A genuinely clean roster is still allowed to say zero.
    expect(screen.getByText(/0 violations matching filters/)).toBeTruthy();
    expect(screen.queryByText(/read failed/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('(c) exposes exactly ONE retry control on the failure path (no duplicate banners)', async () => {
    apiFetch.mockResolvedValue(jsonRes({ error: 'boom' }, 500));
    render(<ViolationsPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // CI previously caught a page that grew a second bespoke error card and
    // shipped two "Retry" buttons. Pin the count.
    expect(screen.getAllByRole('button', { name: /^retry$/i })).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /super-admin/subscribers — state-event runtime. "No subscribers registered."
   reads as a settled fact about the pipeline; it only ever meant "fetch failed".
   ══════════════════════════════════════════════════════════════════════════ */
describe('/super-admin/subscribers — failed read never claims "No subscribers registered."', () => {
  it('(a) FAILED read: retryable alert replaces the table, empty copy suppressed', async () => {
    apiFetch.mockResolvedValue(jsonRes({ success: false, error: 'boom' }, 500));
    render(<SubscribersPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.queryByText('No subscribers registered.')).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('(b) GENUINE EMPTY: the real "No subscribers registered." copy still renders', async () => {
    apiFetch.mockResolvedValue(jsonRes({ success: true, data: { subscribers: [] } }));
    render(<SubscribersPage />);

    await waitFor(() => expect(screen.getByText('No subscribers registered.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   observability SystemSnapshot — the breaker/health/deploy strip. A failed
   fetch left `data` null forever, and the `!data` branch says "Loading…".
   ══════════════════════════════════════════════════════════════════════════ */
describe('observability SystemSnapshot — failed fetch is not a permanent "Loading…"', () => {
  const okData = {
    breakerState: 'closed' as const,
    breakerReason: 'nominal',
    healthStatus: 'healthy' as const,
    healthAgeSeconds: 12,
    lastDeploy: null,
    eventCounts: { info: 0, warning: 0, error: 0, critical: 0 },
  };

  it('(a) FAILED fetch: honest alert + retry, and NOT the loading shell', () => {
    const onRetry = vi.fn();
    render(<SystemSnapshot data={null} loading={false} error="HTTP 500" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Loading snapshot...')).toBeNull();
    // Asserts no status: a strip that cannot read must not show a colour.
    expect(screen.queryByText('healthy')).toBeNull();
    expect(screen.queryByText('closed')).toBeNull();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // 44px touch-target floor, pinned inline so it cannot drift with inheritance.
    expect(retry.style.minHeight).toBe('44px');
    expect(retry.style.minWidth).toBe('44px');
  });

  it('(b) still loading: the loading shell renders and no alert is raised', () => {
    render(<SystemSnapshot data={null} loading={true} error={null} />);
    expect(screen.getByText('Loading snapshot...')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('(c) GENUINE SUCCESS: real status renders, including a legitimate 0 event count', () => {
    render(<SystemSnapshot data={okData} loading={false} error={null} />);

    expect(screen.getByText('closed')).toBeTruthy();
    expect(screen.getByText('healthy')).toBeTruthy();
    // A quiet hour genuinely IS "0 info / 0 warn / 0 err" — that must survive.
    expect(screen.getByText('0 info')).toBeTruthy();
    expect(screen.getByText('0 err')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
