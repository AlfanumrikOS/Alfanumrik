/**
 * Phase 3A Wave A / A4 — Teacher Command Center.
 *
 * Covers the one piece of interactive client behaviour the frontend owns: the
 * at-risk alert "Assign remediation" action.
 *   1. An alert with remediation_status 'none' shows the button; clicking it
 *      POSTs /api/teacher/remediation with the alert's student_id and shows the
 *      assigned state (optimistic).
 *   2. On a failed POST the optimistic flip rolls back (button reappears) and an
 *      error toast is shown.
 *   3. An alert already 'assigned'/'in_progress'/'resolved' shows that state
 *      read-only (no button).
 *
 * NOTE: the Command Center composes the teacher-dashboard Edge via a module
 * `api()` that calls `fetch(SUPABASE_URL/functions/v1/teacher-dashboard)`. We
 * stub global.fetch and branch on the URL: Edge calls return dashboard/heatmap/
 * alerts fixtures; the /api/teacher/remediation call returns the POST result.
 * The server owns remediation state — the client only POSTs and re-reads.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
const mockReplace = vi.fn();
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    teacher: { id: 'teacher-1', name: 'Ms. Rao' },
    isLoading: false,
    isLoggedIn: true,
    activeRole: 'teacher',
    isHi: false,
  }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
  supabaseUrl: 'https://placeholder.supabase.co',
  supabaseAnonKey: 'anon-key',
}));

vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer t' }),
}));

// The Command Center's READ paths now flow through the shared SWR hooks
// (Phase 2 Atlas re-theme). SWR keeps a module-global cache, so each scenario
// here must start from an empty cache or test N would observe test N-1's
// reconciled alert status. We render under an SWRConfig with a fresh provider
// Map per test, which makes every fixture hermetic without changing any
// assertion. (Same pattern as use-teacher-data.test.ts.)
import React from 'react';
import { SWRConfig } from 'swr';
import CommandCenter from '@/app/teacher/CommandCenter';

let swrCache = new Map();
function renderCC() {
  return render(
    React.createElement(
      SWRConfig,
      { value: { provider: () => swrCache, dedupingInterval: 0 } },
      React.createElement(CommandCenter),
    ),
  );
}

const DASHBOARD = {
  teacher: { name: 'Ms. Rao' },
  classes: [{ id: 'class-1', name: 'Grade 7 A', student_count: 3, avg_mastery: 62 }],
  stats: { total_students: 3, active_alerts: 1, critical_alerts: 1, active_assignments: 2 },
};

const HEATMAP = {
  student_count: 1,
  concept_count: 1,
  concepts: [{ id: 'c1', title: 'Motion', chapter: 2 }],
  matrix: [{ student_name: 'Asha', avg_mastery: 40, cells: [{ p_know: 0.4, level: 'low', attempts: 5 }] }],
};

function alertsPayload(remediationStatus: string) {
  return [
    {
      id: 'alert-stu-1-math-critical',
      student_id: 'stu-1',
      student_name: 'Asha',
      severity: 'critical',
      title: 'Asha — critical accuracy in math',
      description: '20% accuracy over 10 questions.',
      recommended_action: 'Schedule a one-on-one revision session.',
      remediation_status: remediationStatus,
    },
  ];
}

/** Build a global.fetch stub. Edge calls branch on the POST body `action`;
 *  the remediation POST is identified by the /api/teacher/remediation path. */
function installFetch(opts: {
  alertsStatus: string;
  remediationOk: boolean;
  heatmapOk?: boolean;
  alertsOk?: boolean;
  onRemediationPost?: (body: unknown) => void;
  // After a successful POST the component re-reads alerts; this is the status
  // the second get_alerts returns.
  alertsStatusAfter?: string;
}) {
  let alertsCalls = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/functions/v1/teacher-dashboard')) {
      const body = JSON.parse((init?.body as string) || '{}');
      if (body.action === 'get_dashboard') {
        return { ok: true, json: async () => DASHBOARD } as Response;
      }
      if (body.action === 'get_heatmap') {
        if (opts.heatmapOk === false) {
          return { ok: false, status: 503, text: async () => 'unavailable' } as Response;
        }
        return { ok: true, json: async () => HEATMAP } as Response;
      }
      if (body.action === 'get_alerts') {
        if (opts.alertsOk === false) {
          return { ok: false, status: 503, text: async () => 'unavailable' } as Response;
        }
        alertsCalls += 1;
        const status =
          alertsCalls > 1 && opts.alertsStatusAfter ? opts.alertsStatusAfter : opts.alertsStatus;
        return { ok: true, json: async () => alertsPayload(status) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }

    if (url.includes('/api/teacher/remediation')) {
      opts.onRemediationPost?.(JSON.parse((init?.body as string) || '{}'));
      return {
        ok: opts.remediationOk,
        status: opts.remediationOk ? 201 : 500,
        json: async () => ({ success: opts.remediationOk }),
        text: async () => '',
      } as Response;
    }

    return { ok: true, json: async () => ({}), text: async () => '' } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  swrCache = new Map();
  mockReplace.mockClear();
  mockPush.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('CommandCenter — assign remediation', () => {
  it('shows the Assign remediation button and POSTs the exact class and student ids', async () => {
    const posted: unknown[] = [];
    installFetch({
      alertsStatus: 'none',
      remediationOk: true,
      alertsStatusAfter: 'assigned',
      onRemediationPost: (b) => posted.push(b),
    });

    renderCC();

    // Wait for the alert + button to render.
    const btn = await screen.findByTestId('assign-remediation-btn');
    expect(btn).toHaveTextContent('Assign remediation');

    fireEvent.click(btn);

    // The POST carries the active class boundary and alert learner.
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ class_id: 'class-1', student_id: 'stu-1' });

    // After the server reconcile, the row shows the assigned state read-only.
    await waitFor(() => {
      expect(screen.getByTestId('remediation-status')).toHaveTextContent('Assigned');
    });
    expect(screen.queryByTestId('assign-remediation-btn')).toBeNull();
  });

  it('rolls back the optimistic flip and shows an error toast on a failed POST', async () => {
    installFetch({ alertsStatus: 'none', remediationOk: false });

    renderCC();

    const btn = await screen.findByTestId('assign-remediation-btn');
    fireEvent.click(btn);

    // Rollback: the button reappears (status returns to none) and an error toast
    // is announced.
    await waitFor(() => {
      expect(screen.getByText(/Couldn't assign/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('assign-remediation-btn')).toBeInTheDocument();
    });
  });

  it('renders the assigned state read-only (no button) when status is in_progress', async () => {
    installFetch({ alertsStatus: 'in_progress', remediationOk: true });

    renderCC();

    const status = await screen.findByTestId('remediation-status');
    expect(status).toHaveTextContent('In progress');
    expect(screen.queryByTestId('assign-remediation-btn')).toBeNull();
  });

  it('exposes the class switcher', async () => {
    installFetch({ alertsStatus: 'none', remediationOk: true });
    renderCC();
    const switcher = await screen.findByTestId('class-switcher');
    expect(within(switcher as HTMLElement).getByText(/Grade 7 A/)).toBeInTheDocument();
  });

  it('renders recoverable errors instead of reassuring empty mastery and alert states', async () => {
    installFetch({
      alertsStatus: 'none',
      remediationOk: true,
      heatmapOk: false,
      alertsOk: false,
    });

    renderCC();

    expect(await screen.findByTestId('heatmap-error')).toHaveTextContent("Couldn't load mastery data.");
    expect(await screen.findByTestId('alerts-error')).toHaveTextContent("Couldn't load at-risk alerts.");
    expect(screen.queryByText('No mastery data yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No at-risk students detected.')).not.toBeInTheDocument();

    const atRiskTile = screen.getByText('At-risk', { selector: 'p' }).parentElement;
    expect(atRiskTile).not.toBeNull();
    expect(within(atRiskTile as HTMLElement).getByText('\u2014')).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('heatmap-error')).getByRole('button', { name: 'Try again' }));
    fireEvent.click(within(screen.getByTestId('alerts-error')).getByRole('button', { name: 'Try again' }));
  });

  it('switches class-scoped roster data and renders unavailable summary metrics honestly', async () => {
    const requestedHeatmaps: string[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.action === 'get_dashboard') {
        return {
          ok: true,
          json: async () => ({
            teacher: { name: 'Ms. Rao' },
            classes: [
              { id: 'class-1', name: 'Grade 7 A', student_count: 1, avg_mastery: 62 },
              { id: 'class-2', name: 'Grade 7 B', student_count: 1, avg_mastery: null },
            ],
            stats: {
              total_students: 2,
              active_alerts: 0,
              critical_alerts: 0,
              active_assignments: null,
            },
          }),
        } as Response;
      }
      if (body.action === 'get_heatmap') {
        requestedHeatmaps.push(body.class_id);
        const isSecond = body.class_id === 'class-2';
        return {
          ok: true,
          json: async () => ({
            class_id: body.class_id,
            student_count: 1,
            concept_count: 1,
            concepts: [{ id: 'c1', title: 'Motion', chapter: 2 }],
            matrix: [{
              student_id: isSecond ? 'student-2' : 'student-1',
              class_id: body.class_id,
              student_name: isSecond ? 'Ravi' : 'Asha',
              grade: '7',
              avg_mastery: isSecond ? null : 62,
              cells: [{ p_know: isSecond ? 0 : 0.62, level: isSecond ? 'none' : 'mid', attempts: isSecond ? 0 : 5 }],
            }],
          }),
        } as Response;
      }
      if (body.action === 'get_alerts') {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    renderCC();

    await screen.findByText('Asha');
    const assignmentsTile = screen.getByText('Assignments', { selector: 'p' }).parentElement;
    expect(assignmentsTile).not.toBeNull();
    expect(within(assignmentsTile as HTMLElement).getByText('\u2014')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('class-switcher'), { target: { value: 'class-2' } });

    await screen.findByText('Ravi');
    expect(screen.queryByText('Asha')).not.toBeInTheDocument();
    expect(requestedHeatmaps).toContain('class-2');
  });
});
