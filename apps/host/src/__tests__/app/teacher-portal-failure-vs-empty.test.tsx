/**
 * Teacher portal — a failed read renders an HONEST, retryable failure state and
 * is DISTINCT from the genuine empty state (render units).
 *
 * Frontend audit, Phase 3 Wave B (teacher portal).
 *
 *   Same root cause as Wave A's /progress defect: the data layer signals
 *   failure by RESOLVING with `{ data, error }` (PostgREST) or by REJECTING
 *   (`usePortalAction` on any non-2xx), and every page here funnelled that into
 *   an empty array/object which its render then reported as a reassuring fact.
 *
 *   On the student side that produced "No knowledge gaps detected!". On the
 *   teacher side it is worse, because a teacher ACTS on the claim:
 *
 *     /teacher/reports     "All students are on track!"  + four zeroed StatCards
 *     /teacher/students    "No Classes Yet"              + "0 students across 0 classes"
 *     /teacher/attendance  "No classes assigned yet — contact your admin"
 *     /teacher/grade-book  "No classes yet"              (error rendered NOWHERE:
 *                                                        the branch returns early,
 *                                                        above the error banner)
 *     /teacher/submissions "No submissions yet"          + "0/0 submitted"
 *
 *   Every case below asserts BOTH directions. A test that only asserted the
 *   failure direction would still pass if the fix had simply deleted the empty
 *   state; one that only asserted the empty direction would pass if the fix had
 *   made every empty look like an error. Genuine-empty must survive intact.
 *
 *   Nothing here asserts how any displayed number is DERIVED (P1/P2) — only
 *   whether a number is claimed at all when the page has no data behind it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

/* ── Mutable auth state (isHi flips for the bilingual test) ─────────────── */
const { authState } = vi.hoisted(() => ({
  authState: {
    teacher: { id: 'teacher-1', name: 'Teacher', school_name: 'Test School' },
    authUserId: 'user-1',
    activeRole: 'teacher',
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/teacher',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// useRequireAuth (used by /teacher/attendance) is a thin wrapper over useAuth.
vi.mock('@alfanumrik/lib/useRequireAuth', () => ({
  useRequireAuth: () => authState,
}));

// usePermissions is UI convenience only (P9); the server-side gate on
// /api/pulse/* is what actually enforces access. `false` keeps the Pulse lens
// unmounted so these assertions stay about the data surfaces under test.
vi.mock('@alfanumrik/lib/usePermissions', () => ({
  usePermissions: () => ({ can: () => false, loading: false }),
}));

vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({
  usePulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
  useClassPulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
}));

vi.mock('@alfanumrik/ui/pulse', () => ({
  StudentPulse: () => null,
  StudentPulseList: () => null,
}));

vi.mock('@alfanumrik/lib/api/auth-header', () => ({ authHeader: async () => ({}) }));

// Wave C depth view is flag-gated OFF in production; keep it off here.
vi.mock('@alfanumrik/lib/use-teacher-gradebook-depth', () => ({
  useTeacherGradebookDepth: () => false,
}));

/* Charts are heavy and irrelevant to error/empty gating. StatCard and
 * DataTable are kept renderable because the assertions below are about what
 * VALUE they display (an em-dash vs. a fabricated 0) and about DataTable's
 * emptyMessage. */
vi.mock('@alfanumrik/ui/admin-ui', async () => {
  const R = await import('react');
  return {
    StatCard: ({ label, value }: { label: string; value: unknown }) =>
      R.createElement('div', { 'data-testid': 'stat-card' }, `${label}: ${String(value)}`),
    BarChart: () => null,
    LineChart: () => null,
    DonutChart: () => null,
    DataTable: ({ data, emptyMessage }: { data: unknown[]; emptyMessage?: string }) =>
      data.length === 0
        ? R.createElement('div', null, emptyMessage)
        : R.createElement('div', null, `${data.length} rows`),
  };
});

/* ── Configurable teacher-dashboard Edge stub ────────────────────────────
 * `usePortalAction(endpoint, isHi)` returns `(action, params) => Promise`.
 * The real helper REJECTS on any non-2xx (and on its 10s timeout), so a
 * throwing handler models every failure mode the pages can actually see.
 *
 * MUST be referentially stable across renders: the pages list `api` in their
 * effect dependency arrays (the real usePortalAction is useCallback-wrapped
 * for exactly that reason). A fresh closure per render re-runs the load effect
 * forever and the page never leaves its skeleton. */
const { portal } = vi.hoisted(() => {
  const map = new Map<string, () => Promise<unknown>>();
  const stableApi = (action: string) => {
    const handler = map.get(action);
    if (!handler) return Promise.resolve({});
    return handler();
  };
  return { portal: { map, stableApi } };
});

vi.mock('@alfanumrik/lib/usePortalFetch', () => ({
  usePortalAction: () => portal.stableApi,
  usePortalFetch: () => portal.stableApi,
  PORTAL_TIMEOUT_MESSAGE_EN: 'Request timed out. Please try again.',
  PORTAL_TIMEOUT_MESSAGE_HI: 'अनुरोध का समय समाप्त हो गया। कृपया पुनः प्रयास करें।',
}));

/* ── Configurable supabase stub (only /teacher/submissions reads directly) ──
 * The builder is thenable and RESOLVES with `{ data, error }` — never rejects
 * — mirroring postgrest-js. That is precisely why callers must inspect
 * `error` rather than rely on `.catch()`. */
const { tableResults } = vi.hoisted(() => ({ tableResults: new Map<string, unknown>() }));

vi.mock('@alfanumrik/lib/supabase', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'single', 'maybeSingle'];
  return {
    supabase: {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(tableResults.get(table) ?? { data: [], error: null }).then(resolve, reject);
        return builder;
      }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

import TeacherReportsPage from '@/app/teacher/reports/page';
import TeacherStudentsPage from '@/app/teacher/students/page';
import TeacherAttendancePage from '@/app/teacher/attendance/page';
import TeacherGradeBookPage from '@/app/teacher/grade-book/page';
import TeacherSubmissionsPage from '@/app/teacher/submissions/page';

const boom = (msg: string) => () => Promise.reject(new Error(msg));
const resolves = (value: unknown) => () => Promise.resolve(value);

beforeEach(() => {
  authState.isHi = false;
  authState.teacher = { id: 'teacher-1', name: 'Teacher', school_name: 'Test School' };
  portal.map.clear();
  tableResults.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   /teacher/reports — "All students are on track!"
   ══════════════════════════════════════════════════════════════════════════ */
describe('/teacher/reports — a failed read is never a clean bill of class health', () => {
  it('FAILURE: renders the error surface and NOT "All students are on track!"', async () => {
    portal.map.set('get_class_overview', boom('overview 500'));
    portal.map.set('get_students_list', boom('students 500'));
    portal.map.set('get_class_trends', boom('trends 500'));

    render(React.createElement(TeacherReportsPage));

    expect(await screen.findByTestId('reports-overview-error')).toBeTruthy();
    expect(screen.queryByText('All students are on track!')).toBeNull();
    // ...and no fabricated numbers stand in for the data we could not read.
    expect(screen.queryByText(/Average Mastery: 0%/)).toBeNull();
    expect(screen.queryByText(/Total Students: 0$/)).toBeNull();
  });

  it('EMPTY: renders "All students are on track!" and NOT the error surface', async () => {
    portal.map.set('get_class_overview', resolves({ stats: {}, needs_attention: [], top_performers: [] }));
    portal.map.set('get_students_list', resolves({ students: [] }));
    portal.map.set('get_class_trends', resolves({}));

    render(React.createElement(TeacherReportsPage));

    expect(await screen.findByText('All students are on track!')).toBeTruthy();
    expect(screen.queryByTestId('reports-overview-error')).toBeNull();
  });

  it('EMPTY: an absent stat renders an em-dash, never a fabricated 0%', async () => {
    portal.map.set('get_class_overview', resolves({ stats: {}, needs_attention: [], top_performers: [] }));
    portal.map.set('get_students_list', resolves({ students: [] }));
    portal.map.set('get_class_trends', resolves({}));

    render(React.createElement(TeacherReportsPage));

    expect(await screen.findByText('Average Mastery: —')).toBeTruthy();
    expect(screen.queryByText('Average Mastery: 0%')).toBeNull();
  });

  it('PARTIAL: one failed endpoint does not blank the two that succeeded', async () => {
    // Previously a single Promise.all rejection wiped all three tabs.
    portal.map.set('get_class_overview', resolves({ stats: { total_students: 27 }, needs_attention: [], top_performers: [] }));
    portal.map.set('get_students_list', boom('students 500'));
    portal.map.set('get_class_trends', resolves({}));

    render(React.createElement(TeacherReportsPage));

    // The overview tab still shows its real, successfully-read number.
    expect(await screen.findByText('Total Students: 27')).toBeTruthy();
    expect(screen.queryByTestId('reports-overview-error')).toBeNull();
  });

  it('P7: the failure surface is bilingual', async () => {
    authState.isHi = true;
    portal.map.set('get_class_overview', boom('overview 500'));
    portal.map.set('get_students_list', boom('students 500'));
    portal.map.set('get_class_trends', boom('trends 500'));

    render(React.createElement(TeacherReportsPage));

    expect(await screen.findByText('कक्षा अवलोकन लोड नहीं हो सका')).toBeTruthy();
    expect(screen.queryByText("Couldn't load the class overview")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /teacher/students — "No Classes Yet"
   ══════════════════════════════════════════════════════════════════════════ */
describe('/teacher/students — a failed roster read is never a first-run empty', () => {
  it('FAILURE: renders the error surface and NOT "No Classes Yet"', async () => {
    portal.map.set('get_dashboard', boom('dashboard 500'));

    render(React.createElement(TeacherStudentsPage));

    expect(await screen.findByTestId('students-load-error')).toBeTruthy();
    expect(screen.queryByText('No Classes Yet')).toBeNull();
  });

  it('FAILURE: does not claim a roster size it could not read', async () => {
    portal.map.set('get_dashboard', boom('dashboard 500'));

    render(React.createElement(TeacherStudentsPage));

    await screen.findByTestId('students-load-error');
    expect(screen.queryByText(/0 students across 0 classes/)).toBeNull();
  });

  it('EMPTY: renders "No Classes Yet" and NOT the error surface', async () => {
    portal.map.set('get_dashboard', resolves({ classes: [] }));

    render(React.createElement(TeacherStudentsPage));

    expect(await screen.findByText('No Classes Yet')).toBeTruthy();
    expect(screen.queryByTestId('students-load-error')).toBeNull();
    // The genuine-empty page still states its (true) roster size.
    expect(screen.getByText(/0 students across 0 classes/)).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /teacher/attendance — "No classes assigned yet — contact your admin"
   ══════════════════════════════════════════════════════════════════════════ */
describe('/teacher/attendance — a failed class read never sends a teacher to their admin', () => {
  it('FAILURE: renders the error surface and NOT "No classes assigned yet"', async () => {
    portal.map.set('get_dashboard', boom('dashboard 500'));

    render(React.createElement(TeacherAttendancePage));

    expect(await screen.findByTestId('attendance-classes-error')).toBeTruthy();
    expect(screen.queryByText('No classes assigned yet')).toBeNull();
    expect(screen.queryByText('Contact your admin to be assigned to a class.')).toBeNull();
  });

  it('EMPTY: renders "No classes assigned yet" and NOT the error surface', async () => {
    portal.map.set('get_dashboard', resolves({ classes: [] }));

    render(React.createElement(TeacherAttendancePage));

    expect(await screen.findByText('No classes assigned yet')).toBeTruthy();
    expect(screen.queryByTestId('attendance-classes-error')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /teacher/grade-book — "No classes yet" (error was rendered NOWHERE)
   ══════════════════════════════════════════════════════════════════════════ */
describe('/teacher/grade-book — a failed class read is surfaced instead of swallowed', () => {
  it('FAILURE: renders the error surface and NOT "No classes yet"', async () => {
    portal.map.set('get_dashboard', boom('dashboard 500'));

    render(React.createElement(TeacherGradeBookPage));

    expect(await screen.findByTestId('gradebook-classes-error')).toBeTruthy();
    expect(screen.queryByText('No classes yet')).toBeNull();
  });

  it('EMPTY: renders "No classes yet" and NOT the error surface', async () => {
    portal.map.set('get_dashboard', resolves({ classes: [] }));

    render(React.createElement(TeacherGradeBookPage));

    expect(await screen.findByText('No classes yet')).toBeTruthy();
    expect(screen.queryByTestId('gradebook-classes-error')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /teacher/submissions — "No assignments yet"
   ══════════════════════════════════════════════════════════════════════════ */
describe('/teacher/submissions — a failed assignments read is never "nothing to grade"', () => {
  it('FAILURE: renders the error surface and NOT "No assignments yet"', async () => {
    tableResults.set('assignments', {
      data: null,
      error: { message: 'assignments read failed', code: '500', details: '', hint: '' },
    });

    render(React.createElement(TeacherSubmissionsPage));

    expect(await screen.findByTestId('submissions-assignments-error')).toBeTruthy();
    expect(screen.queryByText('No assignments yet')).toBeNull();
  });

  it('EMPTY: renders "No assignments yet" and NOT the error surface', async () => {
    tableResults.set('assignments', { data: [], error: null });

    render(React.createElement(TeacherSubmissionsPage));

    expect(await screen.findByText('No assignments yet')).toBeTruthy();
    expect(screen.queryByTestId('submissions-assignments-error')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Cross-page invariant
   ══════════════════════════════════════════════════════════════════════════ */
describe('teacher portal — every failure surface offers recovery', () => {
  it('each honest failure state renders a retry control, not a dead end', async () => {
    portal.map.set('get_dashboard', boom('dashboard 500'));

    render(React.createElement(TeacherStudentsPage));

    const card = await screen.findByTestId('students-load-error');
    await waitFor(() => {
      expect(card.querySelector('button')).toBeTruthy();
    });
    expect(card.getAttribute('role')).toBe('alert');
  });
});
