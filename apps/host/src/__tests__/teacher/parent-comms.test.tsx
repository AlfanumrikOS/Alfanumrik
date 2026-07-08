/**
 * Phase 3A Wave D — Teacher "Tell the parent" parent-comms.
 *
 * Frontend-owned behaviour: the one-tap "Tell the parent" affordance that POSTs
 * /api/teacher/parent-notify, gated behind `ff_teacher_parent_comms`. The server
 * owns thread/message creation; the client only POSTs the right body and renders
 * the outcome toast.
 *
 * Invariants pinned here:
 *   1. Flag ON + a RESOLVED alert → the "Tell the parent 🎉" button renders and,
 *      on click, POSTs /api/teacher/parent-notify with
 *      { student_id, context:'remediation_resolved', include_report:true }. A 200
 *      shows "Parent notified ✓" and collapses the button to a chip
 *      (idempotent-safe: a second click can't re-fire).
 *   2. A 409 { no_guardian:true } renders the INFORMATIONAL "No parent linked"
 *      toast (NOT an error) — the button does not error, it simply reports the
 *      student has no linked parent.
 *   3. Flag OFF → NO "Tell the parent" button is rendered on a RESOLVED alert
 *      (byte-identical to Wave A–C) and NO parent-notify fetch is issued.
 *
 * The Command Center composes the teacher-dashboard Edge via a module `api()`
 * that calls fetch(SUPABASE_URL/functions/v1/teacher-dashboard). We stub
 * global.fetch and branch on the URL: Edge calls return dashboard/heatmap/alerts
 * fixtures; the /api/teacher/parent-notify call returns the POST result.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

// The Command Center's module `api()` reads these; the Wave A–D flag hooks read
// `getFeatureFlags`. A module-level holder lets each test set the flag map.
const flagHolder: { flags: Record<string, boolean> } = { flags: {} };
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
  supabaseUrl: 'https://placeholder.supabase.co',
  supabaseAnonKey: 'anon-key',
  getFeatureFlags: vi.fn(async () => flagHolder.flags),
}));

vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer t' }),
}));

import CommandCenter from '@/app/teacher/CommandCenter';

const DASHBOARD = {
  teacher: { name: 'Ms. Rao' },
  classes: [{ id: 'class-1', name: 'Grade 7 A', student_count: 3, avg_mastery: 62 }],
  stats: { total_students: 3, active_alerts: 1, critical_alerts: 0, active_assignments: 2 },
};

const HEATMAP = {
  student_count: 1,
  concept_count: 1,
  concepts: [{ id: 'c1', title: 'Motion', chapter: 2 }],
  matrix: [
    { student_name: 'Asha', avg_mastery: 70, cells: [{ p_know: 0.7, level: 'mid', attempts: 5 }] },
  ],
};

// A RESOLVED alert — the only state on which "Tell the parent" appears.
function resolvedAlertsPayload() {
  return [
    {
      id: 'alert-stu-1-math-resolved',
      student_id: 'stu-1',
      student_name: 'Asha',
      severity: 'medium',
      title: 'Asha — math remediation',
      description: 'Remediation completed.',
      recommended_action: 'Celebrate the progress.',
      remediation_status: 'resolved',
    },
  ];
}

/** global.fetch stub: Edge calls branch on the POST body `action`; the
 *  parent-notify POST is identified by the /api/teacher/parent-notify path. */
function installFetch(opts: {
  parentNotifyStatus: number;
  parentNotifyBody?: Record<string, unknown>;
  onParentNotifyPost?: (body: unknown) => void;
}) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/functions/v1/teacher-dashboard')) {
      const body = JSON.parse((init?.body as string) || '{}');
      if (body.action === 'get_dashboard') return { ok: true, json: async () => DASHBOARD } as Response;
      if (body.action === 'get_heatmap') return { ok: true, json: async () => HEATMAP } as Response;
      if (body.action === 'get_alerts') {
        return { ok: true, json: async () => resolvedAlertsPayload() } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }

    if (url.includes('/api/teacher/parent-notify')) {
      opts.onParentNotifyPost?.(JSON.parse((init?.body as string) || '{}'));
      const ok = opts.parentNotifyStatus >= 200 && opts.parentNotifyStatus < 300;
      return {
        ok,
        status: opts.parentNotifyStatus,
        json: async () =>
          opts.parentNotifyBody ?? (ok ? { success: true, thread_id: 'th-1', message_id: 'm-1' } : {}),
        text: async () => '',
      } as Response;
    }

    return { ok: true, json: async () => ({}), text: async () => '' } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  flagHolder.flags = {};
  mockReplace.mockClear();
  mockPush.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('CommandCenter — Tell the parent (Wave D)', () => {
  it('flag ON: a resolved alert shows the button and POSTs the right body; 200 → "Parent notified ✓"', async () => {
    flagHolder.flags = { ff_teacher_parent_comms: true };
    const posted: unknown[] = [];
    installFetch({
      parentNotifyStatus: 200,
      onParentNotifyPost: (b) => posted.push(b),
    });

    render(<CommandCenter />);

    // The button appears only once the flag hook resolves ON (async).
    const btn = await screen.findByTestId('tell-parent-btn');
    expect(btn).toHaveTextContent('Tell the parent');

    fireEvent.click(btn);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      student_id: 'stu-1',
      context: 'remediation_resolved',
      include_report: true,
    });

    // 200 → success toast (role=status carries the "✓" outcome) + the button
    // collapses to the "Parent notified" chip.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Parent notified ✓');
    });
    await waitFor(() => {
      expect(screen.getByTestId('parent-notified-chip')).toBeInTheDocument();
    });
    // Idempotent-safe: the button is gone, so a second tap can't re-fire.
    expect(screen.queryByTestId('tell-parent-btn')).toBeNull();
    expect(posted).toHaveLength(1);
  });

  it('flag ON: a 409 no_guardian renders the informational "No parent linked" toast (not an error)', async () => {
    flagHolder.flags = { ff_teacher_parent_comms: true };
    installFetch({
      parentNotifyStatus: 409,
      parentNotifyBody: { success: false, no_guardian: true, error: 'No parent linked to this student' },
    });

    render(<CommandCenter />);

    const btn = await screen.findByTestId('tell-parent-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/No parent linked/i)).toBeInTheDocument();
    });

    // 409 is informational, NOT an error: no error toast, and the button stays
    // available (the student could still be linked later) — not collapsed to a chip.
    expect(screen.queryByText(/Couldn't notify/i)).toBeNull();
    expect(screen.queryByTestId('parent-notified-chip')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('tell-parent-btn')).toBeInTheDocument();
    });
  });

  it('flag OFF: no "Tell the parent" button is rendered on a resolved alert and no parent-notify fetch is issued', async () => {
    flagHolder.flags = { ff_teacher_parent_comms: false };
    const posted: unknown[] = [];
    installFetch({
      parentNotifyStatus: 200,
      onParentNotifyPost: (b) => posted.push(b),
    });

    render(<CommandCenter />);

    // The resolved alert renders (proving the rail is populated), but the Wave D
    // button is absent — byte-identical to Wave A–C.
    await waitFor(() => {
      expect(screen.getByTestId('remediation-status')).toHaveTextContent('Resolved');
    });
    expect(screen.queryByTestId('tell-parent-btn')).toBeNull();

    // And no parent-notify fetch was ever made.
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const parentNotifyCalled = calls.some((c) => String(c[0]).includes('/api/teacher/parent-notify'));
    expect(parentNotifyCalled).toBe(false);
    expect(posted).toHaveLength(0);
  });
});
