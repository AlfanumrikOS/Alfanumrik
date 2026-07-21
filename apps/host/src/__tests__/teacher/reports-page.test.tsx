/**
 * Teacher Reports page (T10) — dashboard/reporting redesign onto the shared
 * admin-ui card + chart primitives (StatCard, BarChart, LineChart, DataTable).
 *
 * Covers:
 *   1. Loading state renders the skeleton before data resolves.
 *   2. Class Overview: headline numbers render via StatCard using the EXACT
 *      values returned by get_class_overview (T8 real BKT mastery) — never
 *      recomputed client-side (P1/P2) — and the mastery-distribution BarChart
 *      is populated (no empty-state fallback) when the cohort has data.
 *   3. Class Overview empty state: zero students renders the zero-state copy
 *      and StatCard values of 0, no crash.
 *   4. Student Analysis: the DataTable lists students (drill-in list); a row
 *      click loads get_student_report and renders its numbers via StatCard,
 *      and the subject BarChart is populated from get_student_report's
 *      subjects verbatim.
 *   5. Trends: the weekly-progress LineChart is populated (no empty-state)
 *      when get_class_trends returns weekly_progress data.
 *   6. Error banner renders and Retry re-fetches.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';

// jsdom doesn't lay out — ResponsiveContainer measures 0×0 without this mock,
// which makes Recharts skip rendering the inner svg. Same pattern as
// LineChart.test.tsx / BarChart tests.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
      <div style={{ width: 600, height: 300 }}>
        {React.cloneElement(children, { width: 600, height: 300 })}
      </div>
    ),
  };
});

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
}));

import TeacherReportsPage from '@/app/teacher/reports/page';

const CLASS_OVERVIEW = {
  stats: { total_students: 20, avg_mastery: 64, avg_accuracy: 58, active_this_week: 12 },
  mastery_distribution: { mastered: 20, proficient: 30, familiar: 25, developing: 15, not_started: 10 },
  top_performers: [{ name: 'Asha', student_name: 'Asha', xp: 500, total_xp: 500, mastery: 88 }],
  needs_attention: [{ name: 'Ravi', student_name: 'Ravi', mastery: 32, reason: '32% mastery' }],
};

const EMPTY_CLASS_OVERVIEW = {
  stats: { total_students: 0, avg_mastery: 0, avg_accuracy: 0, active_this_week: 0 },
  mastery_distribution: { mastered: 0, proficient: 0, familiar: 0, developing: 0, not_started: 0 },
  top_performers: [],
  needs_attention: [],
};

const STUDENTS_LIST = { students: [{ id: 'stu-1', name: 'Asha' }, { id: 'stu-2', name: 'Ravi' }] };

const STUDENT_REPORT = {
  student_id: 'stu-1',
  name: 'Asha',
  student_name: 'Asha',
  xp: 500,
  total_xp: 500,
  streak: 5,
  current_streak: 5,
  accuracy: 78,
  avg_accuracy: 78,
  mastery: 82,
  bkt_mastery: 82,
  subjects: [
    { subject: 'math', name: 'math', mastery: 82, level: 'mastered' },
    { subject: 'science', name: 'science', mastery: 55, level: 'familiar' },
  ],
  subject_mastery: [
    { subject: 'math', name: 'math', mastery: 82, level: 'mastered' },
    { subject: 'science', name: 'science', mastery: 55, level: 'familiar' },
  ],
  strengths: ['math'],
  weaknesses: ['science'],
  recommendations: ['Student is on track — continue with current plan.'],
};

const CLASS_TRENDS = {
  class_id: null,
  daily: [],
  weekly_progress: [
    { label: 'Week 1', week: 'Week 1', progress: 40, percent: 40 },
    { label: 'Week 2', week: 'Week 2', progress: 55, percent: 55 },
  ],
  activity_heatmap: [],
  most_improved: [{ name: 'Asha', student_name: 'Asha', improvement: 12, delta: 12 }],
  week_over_week_delta: 10,
};

function installFetch(overrides?: {
  classOverview?: unknown;
  studentsList?: unknown;
  classTrends?: unknown;
  studentReport?: unknown;
  failOverview?: boolean;
}) {
  global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.action === 'get_class_overview') {
      if (overrides?.failOverview) {
        return { ok: false, status: 500, text: async () => 'boom' } as Response;
      }
      return { ok: true, json: async () => overrides?.classOverview ?? CLASS_OVERVIEW } as Response;
    }
    if (body.action === 'get_students_list') {
      return { ok: true, json: async () => overrides?.studentsList ?? STUDENTS_LIST } as Response;
    }
    if (body.action === 'get_class_trends') {
      return { ok: true, json: async () => overrides?.classTrends ?? CLASS_TRENDS } as Response;
    }
    if (body.action === 'get_student_report') {
      return { ok: true, json: async () => overrides?.studentReport ?? STUDENT_REPORT } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('Teacher Reports page — Class Overview', () => {
  it('renders StatCard headline numbers verbatim from get_class_overview and a populated distribution chart', async () => {
    installFetch();
    render(<TeacherReportsPage />);

    // Loading skeleton first (aria-busy region).
    expect(screen.getByRole('status', { name: /Loading reports/i })).toBeInTheDocument();

    // Headline StatCard numbers — exact values from the Edge response.
    expect(await screen.findByText('20', { selector: 'div' })).toBeInTheDocument(); // total_students
    expect(screen.getByText('64%')).toBeInTheDocument(); // avg_mastery
    expect(screen.getByText('58%')).toBeInTheDocument(); // avg_accuracy
    expect(screen.getByText('12', { selector: 'div' })).toBeInTheDocument(); // active_this_week

    // Distribution BarChart is populated — no empty-state fallback text.
    expect(screen.queryByText('No mastery data yet')).not.toBeInTheDocument();

    // Top performer / needs-attention lists still render (unchanged card lists).
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('Ravi')).toBeInTheDocument();
  });

  it('renders the empty state (zero students) without crashing', async () => {
    installFetch({ classOverview: EMPTY_CLASS_OVERVIEW, studentsList: { students: [] } });
    render(<TeacherReportsPage />);

    await waitFor(() => expect(screen.getAllByText('0%').length).toBeGreaterThan(0));
    expect(screen.getByText('All students are on track!')).toBeInTheDocument();
    expect(screen.getByText('No data available yet.')).toBeInTheDocument();
  });

  it('shows the error banner and retries on click', async () => {
    installFetch({ failOverview: true });
    render(<TeacherReportsPage />);

    expect(await screen.findByText(/API error 500/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Retry' });

    installFetch(); // subsequent calls succeed
    fireEvent.click(retryBtn);

    expect(await screen.findByText('64%')).toBeInTheDocument();
  });
});

describe('Teacher Reports page — Student Analysis', () => {
  it('lists students via the DataTable drill-in and loads the profile on row click', async () => {
    installFetch();
    render(<TeacherReportsPage />);
    await screen.findByText('64%'); // wait for initial load

    fireEvent.click(screen.getByRole('button', { name: 'Student Analysis' }));

    // DataTable row for each student.
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('Ravi')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Asha'));

    // Student profile StatCards — verbatim from get_student_report.
    expect(await screen.findByText('500')).toBeInTheDocument(); // xp
    expect(screen.getByText('78%')).toBeInTheDocument(); // accuracy

    // Subject mastery BarChart populated — no "no subject data" fallback.
    expect(screen.queryByText('No subject data available.')).not.toBeInTheDocument();
  });
});

describe('Teacher Reports page — Trends', () => {
  it('renders the weekly-progress LineChart populated from get_class_trends', async () => {
    installFetch();
    render(<TeacherReportsPage />);
    await screen.findByText('64%');

    fireEvent.click(screen.getByRole('button', { name: 'Trends' }));

    await waitFor(() => {
      expect(screen.queryByText('No weekly progress data yet.')).not.toBeInTheDocument();
    });
    // Most-improved list (unchanged) still renders.
    const mostImproved = within(screen.getByText('Most Improved Students').closest('div') as HTMLElement);
    expect(mostImproved.getByText('Asha')).toBeInTheDocument();
  });
});
