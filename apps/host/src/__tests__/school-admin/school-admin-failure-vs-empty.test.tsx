/**
 * School-admin portal — a failed read renders an HONEST, retryable failure and
 * stays DISTINCT from the genuine empty state (render units).
 *
 * Frontend audit, Wave D (school-admin portal). Same root cause the student,
 * teacher and parent waves already fixed:
 *
 *   `supabase.rpc()` / the PostgREST builder RESOLVE with `{ data, error }` and
 *   `fetch()` RESOLVES on 4xx/5xx. So `try/catch`, `.catch()` and `if (res.ok)`
 *   happy-paths swallow failure, and `data ?? []` / a `0`-seeded state makes a
 *   FAILED read indistinguishable from a genuinely empty one.
 *
 * A school admin ACTS on these screens, and reports the numbers upward:
 *
 *   /school-admin/rbac        "No elevations" / "No delegation tokens" /
 *                             "All approval requests have been handled" + 0/0/0
 *                             — a privilege-governance all-clear produced by a 500.
 *   /school-admin/billing     "No invoices yet" + "Seats Used 0 / 0" + "₹0"
 *                             — a money figure produced by a failed read.
 *   /school-admin/escalations "No escalations" with no session token at all.
 *   /school-admin/reports     "No students found." after a failed search — an
 *                             admin concludes a child is not enrolled.
 *   /school-admin/classes     a RED "Avg Mastery 0%" bar on every class card,
 *                             for a column `get_school_classes` never returns.
 *
 * EVERY case below asserts BOTH directions. A failure-only assertion would still
 * pass against a page that had simply deleted its empty state; an empty-only
 * assertion would pass against a page that made every empty look like an error.
 * Genuine-empty — and a genuine ZERO — must survive intact.
 *
 * Nothing here asserts how a displayed number is DERIVED (P1/P2). These are only
 * about whether a number/claim is asserted at all when nothing was read.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

/* ── Auth (mutable so a bilingual assertion can flip isHi) ─────────────────── */
const { authState } = vi.hoisted(() => ({
  authState: {
    authUserId: 'auth-user-1',
    isLoading: false,
    isLoggedIn: true,
    isHi: false,
    signOut: vi.fn(),
    setLanguage: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/school-admin',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@alfanumrik/lib/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, loading: false }),
}));

/* Code-split panels are irrelevant to error/empty gating; keep their chunks out
 * of jsdom entirely. */
vi.mock('next/dynamic', () => ({ default: () => () => null }));

/* Charts are heavy and assert nothing here. */
vi.mock('@alfanumrik/ui/admin-ui/charts', () => ({
  LineChart: () => null,
  BarChart: () => null,
  DonutChart: () => null,
}));

/* ── Controllable Supabase backend ─────────────────────────────────────────────
 * The real builder is a thenable that RESOLVES with { data, error } — modelling
 * it any other way would let a `try/catch` look like it works. */
type Result = { data: unknown; error: { message: string } | null };

const { backend } = vi.hoisted(() => ({
  backend: {
    tables: new Map<string, Result>(),
    rpcs: new Map<string, Result>(),
    session: { access_token: 'token-abc' } as { access_token: string } | null,
  },
}));

function chainFor(get: () => Result) {
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (onOk: any, onErr: any) => Promise.resolve(get()).then(onOk, onErr);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      chainFor(() => backend.tables.get(table) ?? { data: null, error: null }),
    rpc: (name: string) =>
      chainFor(() => backend.rpcs.get(name) ?? { data: [], error: null }),
    auth: {
      getSession: async () => ({ data: { session: backend.session } }),
    },
  },
  getFeatureFlags: async () => ({}),
}));

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: backend.session } }) },
  },
}));

/* The school-admin identity hook: resolved school for every page under test.
 * Its own failure path is separately covered by each page's admin-error card. */
vi.mock('@alfanumrik/ui/school-admin/use-school-admin-auth', () => ({
  useSchoolAdminAuth: () => ({
    schoolId: 'school-1',
    admin: { school_id: 'school-1', name: 'Principal', email: null, role: 'principal' },
    isLoading: false,
    error: null,
  }),
  default: () => ({ schoolId: 'school-1', admin: null, isLoading: false, error: null }),
}));

/* ── Controllable HTTP backend ────────────────────────────────────────────────
 * Matched by URL fragment. A handler returning `null` means "no route" → 404,
 * which is itself a failure the page must not render as empty. */
const { http } = vi.hoisted(() => ({
  http: { routes: [] as Array<[string, () => { ok: boolean; status: number; body: unknown }]> },
}));

function route(fragment: string, make: () => { ok: boolean; status: number; body: unknown }) {
  http.routes.unshift([fragment, make]);
}

function installFetch() {
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input);
    const hit = http.routes.find(([frag]) => url.includes(frag));
    const res = hit ? hit[1]() : { ok: false, status: 404, body: { error: 'no stub' } };
    return {
      ok: res.ok,
      status: res.status,
      json: async () => res.body,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

vi.mock('@alfanumrik/lib/school-admin/authed-fetch', () => ({
  authedFetch: (url: string, init?: RequestInit) => (globalThis.fetch as any)(url, init),
  getAccessToken: async () => backend.session?.access_token ?? null,
}));

vi.mock('@alfanumrik/lib/authed-fetch', () => ({
  authedFetch: (url: string, init?: RequestInit) => (globalThis.fetch as any)(url, init),
  getAccessToken: async () => backend.session?.access_token ?? null,
}));

import RbacPage from '@/app/school-admin/rbac/page';
import BillingPage from '@/app/school-admin/billing/page';
import ClassesPage from '@/app/school-admin/classes/page';
import EscalationsPage from '@/app/school-admin/escalations/page';
import ReportsPage from '@/app/school-admin/reports/page';

const ok = (body: unknown) => () => ({ ok: true, status: 200, body });
const fail = (status: number, error: string) => () => ({ ok: false, status, body: { error } });

beforeEach(() => {
  backend.tables.clear();
  backend.rpcs.clear();
  backend.session = { access_token: 'token-abc' };
  http.routes = [];
  authState.isHi = false;
  // Every page under test first resolves its own school_admins row.
  backend.tables.set('school_admins', {
    data: { school_id: 'school-1', name: 'Principal', email: null, role: 'principal' },
    error: null,
  });
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ═══════════════════════════════════════════════════════════════════════════
   /school-admin/rbac — privilege governance. The worst place on the portal to
   render a reassuring zero.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('/school-admin/rbac — failure vs genuine empty', () => {
  it('a failed elevations read shows a retryable failure, NOT "No elevations"', async () => {
    route('action=elevations', fail(500, 'internal error'));
    route('action=dashboard_stats', ok({ data: { activeElevations: 0, activeDelegations: 0, pendingApprovals: 0 } }));

    render(<RbacPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Elevations' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByText(/Couldn.t load elevations/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
    // The reassuring claim must be gone.
    expect(screen.queryByText('No elevations')).toBeNull();
  });

  it('a genuinely empty elevations list still shows "No elevations" and NO error', async () => {
    route('action=elevations', ok({ data: [] }));
    route('action=dashboard_stats', ok({ data: { activeElevations: 0, activeDelegations: 0, pendingApprovals: 0 } }));

    render(<RbacPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Elevations' }));

    expect(await screen.findByText('No elevations')).toBeTruthy();
    expect(screen.queryByText(/Couldn.t load elevations/i)).toBeNull();
  });

  it('a failed approvals read never claims "All approval requests have been handled"', async () => {
    route('action=approvals', fail(403, 'forbidden'));
    route('action=dashboard_stats', ok({ data: { activeElevations: 0, activeDelegations: 0, pendingApprovals: 0 } }));

    render(<RbacPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Approvals' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('All approval requests have been handled.')).toBeNull();
  });

  it('a genuinely empty approvals list DOES claim "All approval requests have been handled"', async () => {
    route('action=approvals', ok({ data: [] }));
    route('action=dashboard_stats', ok({ data: { activeElevations: 0, activeDelegations: 0, pendingApprovals: 0 } }));

    render(<RbacPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Approvals' }));

    expect(await screen.findByText('All approval requests have been handled.')).toBeTruthy();
  });

  it('failed dashboard stats render an em dash; a genuine zero still renders 0', async () => {
    // Failure direction.
    route('action=dashboard_stats', fail(500, 'internal error'));
    const { unmount } = render(<RbacPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const elevationTile = screen.getByText('Active Elevations').parentElement!;
    expect(elevationTile.textContent).toContain('—');
    expect(elevationTile.textContent).not.toMatch(/\b0\b/);
    unmount();
    cleanup();

    // Genuine-zero direction: a school that really has no elevations reads 0.
    http.routes = [];
    route('action=dashboard_stats', ok({ data: { activeElevations: 0, activeDelegations: 2, pendingApprovals: 0 } }));
    render(<RbacPage />);

    await waitFor(() => {
      const tile = screen.getByText('Active Elevations').parentElement!;
      expect(tile.textContent).toContain('0');
    });
    expect(screen.getByText('Active Delegations').parentElement!.textContent).toContain('2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the failure surface is bilingual (P7)', async () => {
    authState.isHi = true;
    route('action=delegations', fail(500, 'internal error'));
    route('action=dashboard_stats', ok({ data: { activeElevations: 0, activeDelegations: 0, pendingApprovals: 0 } }));

    render(<RbacPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'प्रतिनिधि' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('प्रतिनिधि टोकन लोड नहीं हो सके')).toBeTruthy();
    expect(screen.queryByText('कोई प्रतिनिधि टोकन नहीं')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   /school-admin/billing — seats and money. A ₹0 here is reported upward.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('/school-admin/billing — failure vs genuine empty', () => {
  const school = {
    data: { id: 'school-1', name: 'Test School', max_students: 200, subscription_plan: 'standard' },
    error: null,
  };

  it('a failed seat-usage read shows a retryable failure, NOT "No usage data yet" / ₹0', async () => {
    backend.tables.set('schools', school);
    backend.tables.set('school_seat_usage', { data: null, error: { message: 'permission denied' } });
    route('/api/school-admin/invoices', ok({ data: { invoices: [] } }));

    render(<BillingPage />);

    expect(await screen.findByText('permission denied')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
    expect(screen.queryByText('No usage data yet')).toBeNull();
    expect(screen.queryByText('No invoices yet')).toBeNull();
    expect(screen.queryByText(/₹0/)).toBeNull();
  });

  it('a failed invoices read shows a failure, NOT "No invoices yet"', async () => {
    backend.tables.set('schools', school);
    backend.tables.set('school_seat_usage', { data: [], error: null });
    route('/api/school-admin/invoices', fail(403, 'forbidden'));

    render(<BillingPage />);

    expect(await screen.findByText('forbidden')).toBeTruthy();
    expect(screen.queryByText('No invoices yet')).toBeNull();
  });

  it('a failed school-profile read never renders a fabricated plan/seat/cost tile', async () => {
    backend.tables.set('schools', { data: null, error: { message: 'schools read failed' } });
    route('/api/school-admin/invoices', ok({ data: { invoices: [] } }));

    render(<BillingPage />);

    expect(await screen.findByText('schools read failed')).toBeTruthy();
    expect(screen.queryByText('Current Plan')).toBeNull();
    expect(screen.queryByText('Seats Used')).toBeNull();
    expect(screen.queryByText('Monthly Cost')).toBeNull();
  });

  it('genuinely empty billing data still renders the empty states and NO error', async () => {
    backend.tables.set('schools', school);
    backend.tables.set('school_seat_usage', { data: [], error: null });
    route('/api/school-admin/invoices', ok({ data: { invoices: [] } }));

    render(<BillingPage />);

    expect(await screen.findByText('No invoices yet')).toBeTruthy();
    expect(screen.getByText('No usage data yet')).toBeTruthy();
    // No snapshot exists ⇒ the seat count is UNKNOWN, so it must read as a dash.
    expect(screen.getByText('Seats Used').parentElement!.textContent).toContain('—');
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });

  it('a genuine zero-seat snapshot still renders 0, not a dash', async () => {
    backend.tables.set('schools', school);
    backend.tables.set('school_seat_usage', {
      data: [{ snapshot_date: '2026-08-01', active_students: 0, seats_purchased: 200, utilization_pct: 0 }],
      error: null,
    });
    route('/api/school-admin/invoices', ok({ data: { invoices: [] } }));

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Seats Used').parentElement!.textContent).toContain('0 / 200');
    });
    // A real snapshot of zero active students is a real ₹0 — that must still show.
    expect(screen.getByText('Monthly Cost').parentElement!.textContent).toMatch(/₹\s?0/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   /school-admin/escalations — a queue an admin is expected to work.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('/school-admin/escalations — failure vs genuine empty', () => {
  it('an expired session shows a retryable failure, NOT "No escalations"', async () => {
    backend.session = null;

    render(<EscalationsPage />);

    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeTruthy();
    expect(screen.queryByText('No escalations')).toBeNull();
  });

  it('a failed escalations read shows a retryable failure, NOT "No escalations"', async () => {
    route('/api/school-admin/escalations', fail(500, 'escalations read failed'));

    render(<EscalationsPage />);

    expect(await screen.findByText('escalations read failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
    expect(screen.queryByText('No escalations')).toBeNull();
  });

  it('a genuinely empty queue still shows "No escalations" and NO error', async () => {
    route('/api/school-admin/escalations', ok({ success: true, data: [] }));

    render(<EscalationsPage />);

    expect(await screen.findByText('No escalations')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   /school-admin/classes — "Avg Mastery" had no source and rendered a red 0%.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('/school-admin/classes — an absent mastery figure is not a zero', () => {
  const rowWithoutMastery = {
    id: 'class-1',
    name: 'Class 8A Science',
    grade: '8',
    section: 'A',
    subject: 'Science',
    class_code: 'ABC123',
    created_at: '2026-01-01T00:00:00Z',
    student_count: 31,
    teachers: [{ id: 't1', name: 'Teacher One' }],
  };

  it('renders a dash — never 0% — when the RPC carries no avg_mastery column', async () => {
    backend.rpcs.set('get_school_classes', { data: [rowWithoutMastery], error: null });

    render(<ClassesPage />);

    expect(await screen.findByText('Class 8A Science')).toBeTruthy();
    expect(screen.getByTestId('class-avg-mastery-unavailable')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('a genuine 0 mastery still renders 0%', async () => {
    backend.rpcs.set('get_school_classes', {
      data: [{ ...rowWithoutMastery, avg_mastery: 0 }],
      error: null,
    });

    render(<ClassesPage />);

    expect(await screen.findByText('Class 8A Science')).toBeTruthy();
    expect(screen.queryByTestId('class-avg-mastery-unavailable')).toBeNull();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('a failed class read shows a retryable failure, NOT "No classes yet"', async () => {
    backend.rpcs.set('get_school_classes', { data: null, error: { message: 'rpc blew up' } });

    render(<ClassesPage />);

    expect(await screen.findByText('rpc blew up')).toBeTruthy();
    expect(screen.queryByText('No classes yet')).toBeNull();
  });

  it('a genuinely empty class list still shows "No classes yet"', async () => {
    backend.rpcs.set('get_school_classes', { data: [], error: null });

    render(<ClassesPage />);

    expect(await screen.findByText('No classes yet')).toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   /school-admin/reports — "No students found." after a failed search told an
   admin a child was not enrolled at their own school.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('/school-admin/reports — student search failure vs genuine empty', () => {
  function openStudentTab() {
    window.history.replaceState({}, '', '/school-admin/reports?tab=student_detail');
  }

  async function typeQuery() {
    const input = await screen.findByLabelText('Search student by name');
    fireEvent.change(input, { target: { value: 'Aar' } });
  }

  it('a failed search shows a retryable failure, NOT "No students found."', async () => {
    openStudentTab();
    route('type=student_search', fail(500, 'search failed'));

    render(<ReportsPage />);
    await typeQuery();

    // AdminErrorState's compact variant renders "<heading>: <message>" in one node.
    await waitFor(() => expect(screen.getByText(/search failed/)).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No students found.')).toBeNull();
  });

  it('a genuinely empty search still shows "No students found." and NO error', async () => {
    openStudentTab();
    route('type=student_search', ok({ success: true, data: [] }));

    render(<ReportsPage />);
    await typeQuery();

    await waitFor(() => expect(screen.getByText('No students found.')).toBeTruthy(), { timeout: 4000 });
    expect(screen.queryByText(/Couldn.t search students/i)).toBeNull();
  });
});
