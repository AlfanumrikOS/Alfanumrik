import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ParentReportsPage from '@/app/parent/reports/page';

// Regression coverage for parent-dashboard RCA Task 3.1 (2026-07-20):
// /parent/reports was refactored to delegate its SummaryCard, SubjectCard
// mastery bar, and CircularProgressRing components to the canonical
// design-system primitives (admin-ui StatCard, ui/primitives ProgressBar,
// ui/primitives ProgressRing) instead of hand-rolled inline-styled markup.
// This test renders the page with a realistic successful report payload
// and asserts the refactored components actually render the underlying
// data correctly -- proving the presentational swap did not silently drop
// or corrupt any values.

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams('childId=student-2'),
  router: { replace: vi.fn(), push: vi.fn() },
}));

const authState = vi.hoisted(() => ({
  isHi: false,
  isLoading: false,
  guardian: { id: 'guardian-1', name: 'Parent' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

function mockFetchImpl(input: RequestInfo | URL, init?: RequestInit) {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (body.action === 'get_children') {
    return Promise.resolve(
      new Response(
        JSON.stringify({ children: [{ id: 'student-2', name: 'Aarav', grade: '8' }] }),
        { status: 200 },
      ),
    );
  }
  if (body.action === 'get_child_dashboard') {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          stats: { overallMastery: 82, streak: 5, accuracy: 88, xp: 1240, accuracyTrend: 'up' },
          subjects: [
            { name: 'Math', mastery: 90, recentScore: 95, topicsMastered: 9, totalTopics: 10 },
            { name: 'Science', mastery: 45, recentScore: 40 },
          ],
          dailyActivity: [],
          concepts: [],
          quizHistory: [],
          insights: [],
          parentTips: [],
        }),
        { status: 200 },
      ),
    );
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
}

describe('parent reports design-system refactor renders real data correctly', () => {
  it('renders StatCard headline stats with correct values from the API response', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchImpl));

    render(<ParentReportsPage />);

    // SummaryCard passes XP as a pre-formatted string ("1240"), so StatCard
    // renders it verbatim rather than through its numeric toLocaleString
    // branch (that branch only applies when the value prop is a number).
    await waitFor(() => expect(screen.getByText('1240')).toBeInTheDocument());
    // Overall mastery StatCard value.
    expect(screen.getByText('82%')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('renders the SubjectCard mastery ProgressBar with correct progressbar role and value', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetchImpl));

    render(<ParentReportsPage />);

    await waitFor(() => expect(screen.getByText('Math')).toBeInTheDocument());

    // ProgressBar renders role="progressbar" with aria-valuenow matching mastery.
    const progressBars = await screen.findAllByRole('progressbar');
    const masteryValues = progressBars.map((el) => el.getAttribute('aria-valuenow'));
    expect(masteryValues).toContain('90');
    expect(masteryValues).toContain('45');

    vi.unstubAllGlobals();
  });
});
