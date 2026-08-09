/**
 * Teacher Command Center — the at-risk rail never issues an all-clear on
 * half the evidence.
 *
 * Frontend audit, Phase 3 Wave B (teacher portal).
 *
 *   The rail is a UNION of two independent sources (see
 *   packages/lib/src/teacher/alert-reconciler.ts): the legacy `get_alerts`
 *   Edge read and Student Pulse's three signals. Pulse contributes students
 *   that `get_alerts` produces no row for at all.
 *
 *   `useClassPulse`'s `error` was discarded. When that read failed the union
 *   silently SHRANK — every Pulse-only at-risk student disappeared from the
 *   rail, the "At-risk" tile under-counted, and the share-of-roster donut
 *   redistributed the missing students into its "On track" slice. With the
 *   legacy source also empty, the rail printed:
 *
 *       ✓  No at-risk students detected.
 *
 *   That is a green light on a class the page only half-read, and a teacher
 *   acts on it by doing nothing.
 *
 *   Both directions are asserted: a Pulse failure must suppress the all-clear
 *   and the count; a healthy Pulse that genuinely returns no at-risk students
 *   must still produce the all-clear. The reconciler itself is NOT mocked —
 *   the real merge logic runs, so this pins the rendered verdict rather than a
 *   restatement of the mock.
 *
 *   No assertion here touches how any number is DERIVED (P1/P2); only whether
 *   a claim is made when a contributing source failed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/* ── Mutable hook state, driven per test ────────────────────────────────── */
const { state } = vi.hoisted(() => ({
  state: {
    isHi: false,
    alerts: [] as unknown[],
    alertsError: null as unknown,
    pulseData: null as unknown,
    pulseError: null as unknown,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    teacher: { id: 'teacher-1', name: 'Teacher' },
    isLoading: false,
    isLoggedIn: true,
    activeRole: 'teacher',
    get isHi() { return state.isHi; },
  }),
}));

// All three Wave B/C/D flags default OFF in production.
vi.mock('@alfanumrik/lib/use-teacher-assignment-lifecycle', () => ({
  useTeacherAssignmentLifecycle: () => false,
}));
vi.mock('@alfanumrik/lib/use-teacher-gradebook-depth', () => ({
  useTeacherGradebookDepth: () => false,
}));
vi.mock('@alfanumrik/lib/use-teacher-parent-comms', () => ({
  useTeacherParentComms: () => false,
}));

vi.mock('@alfanumrik/lib/api/auth-header', () => ({ authHeader: async () => ({}) }));

const CLASS_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@alfanumrik/lib/teacher/use-teacher-data', () => ({
  useTeacherDashboard: () => ({
    data: {
      teacher: { name: 'Teacher' },
      classes: [{ id: CLASS_ID, name: 'Class 8A', student_count: 30 }],
      stats: { total_students: 30, active_assignments: 2 },
    },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
  useHeatmap: () => ({ data: null, isLoading: false, error: null, mutate: vi.fn() }),
  useAlerts: () => ({
    data: state.alerts,
    isLoading: false,
    error: state.alertsError,
    mutate: vi.fn(),
  }),
  useGradingQueue: () => ({ data: null, isLoading: false, error: null, mutate: vi.fn() }),
  useStudentMasteryReport: () => ({ data: null, isLoading: false, error: null, mutate: vi.fn() }),
  useClassLeaderboard: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
  useMisconceptionClusters: () => ({ data: null }),
  useInTheMomentAlerts: () => ({ data: null, mutate: vi.fn() }),
  useClassOverview: () => ({ data: null }),
  recordInterventionDecision: vi.fn(),
  teacherDashboardFetch: vi.fn(),
}));

vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({
  useClassPulse: () => ({
    data: state.pulseData,
    error: state.pulseError,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

vi.mock('@alfanumrik/ui/admin-ui/charts/DonutChart', () => ({ DonutChart: () => null }));

import CommandCenter from '@/app/teacher/CommandCenter';

/**
 * A Pulse row the REAL reconciler classifies as at-risk. The signal shape is
 * the live `PulseSignals` contract (packages/lib/src/pulse/types.ts) — this
 * fixture deliberately runs through `pulseReasonsAndSeverity` rather than
 * stubbing its verdict, so the test breaks if the merge contract drifts.
 */
const PULSE_AT_RISK = {
  studentId: 'stu-9',
  displayName: 'Pulse-only student',
  grade: '8',
  status: 'at_risk',
  totalAtRiskChapters: 4,
  signals: {
    inactivity: { verdict: 'broken', daysSinceActive: 5 },
    masteryCliff: { verdict: 'flagged', worstSubject: 'math' },
    atRiskConcentration: {
      worstBand: 'high',
      totalAtRiskChapters: 4,
      bySubject: [{ subject: 'math', atRiskChapters: 4, band: 'high' }],
    },
  },
};

beforeEach(() => {
  state.isHi = false;
  state.alerts = [];
  state.alertsError = null;
  state.pulseData = null;
  state.pulseError = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Command Center at-risk rail — a half-read class is never an all-clear', () => {
  it('FAILURE (Pulse): suppresses "No at-risk students detected." and offers retry', async () => {
    state.alerts = [];
    state.pulseError = Object.assign(new Error('pulse 500'), { status: 500 });

    render(<CommandCenter />);

    expect(await screen.findByTestId('alerts-partial')).toBeTruthy();
    expect(screen.queryByText('No at-risk students detected.')).toBeNull();
    // Recovery, not a dead end.
    const partial = screen.getByTestId('alerts-partial');
    expect(partial.getAttribute('role')).toBe('alert');
    expect(partial.querySelector('button')).toBeTruthy();
  });

  it('FAILURE (Pulse): the At-risk tile shows an em-dash, not an undercount', async () => {
    state.alerts = [];
    state.pulseError = Object.assign(new Error('pulse 500'), { status: 500 });

    render(<CommandCenter />);

    await screen.findByTestId('alerts-partial');
    expect(screen.getByText('At-risk').parentElement?.textContent).toContain('—');
    expect(screen.queryByTestId('risk-breakdown-donut')).toBeNull();
  });

  it('EMPTY: a healthy Pulse that finds nobody still yields the all-clear', async () => {
    state.alerts = [];
    state.pulseData = { students: [] };
    state.pulseError = null;

    render(<CommandCenter />);

    expect(await screen.findByText('No at-risk students detected.')).toBeTruthy();
    expect(screen.queryByTestId('alerts-partial')).toBeNull();
  });

  it('POPULATED: a Pulse-only at-risk student still reaches the rail', async () => {
    state.alerts = [];
    state.pulseData = { students: [PULSE_AT_RISK] };

    render(<CommandCenter />);

    expect(await screen.findByText(/Pulse-only student/)).toBeTruthy();
    expect(screen.queryByText('No at-risk students detected.')).toBeNull();
    expect(screen.queryByTestId('alerts-partial')).toBeNull();
  });

  it('P7: the partial-evidence notice is bilingual', async () => {
    state.isHi = true;
    state.alerts = [];
    state.pulseError = Object.assign(new Error('pulse 500'), { status: 500 });

    render(<CommandCenter />);

    const partial = await screen.findByTestId('alerts-partial');
    expect(partial.textContent).toContain('जोखिम जांच का एक हिस्सा लोड नहीं हुआ');
    expect(partial.textContent).not.toContain("Part of the at-risk check didn't load");
  });
});
