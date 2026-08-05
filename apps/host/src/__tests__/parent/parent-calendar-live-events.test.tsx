import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ParentCalendarPage from '@/app/parent/calendar/page';

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

describe('parent calendar live events', () => {
  beforeEach(() => {
    navigation.router.replace.mockReset();
    navigation.router.push.mockReset();
    const examDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v2/parent/children') {
        return new Response(JSON.stringify({
          success: true,
          data: {
            children: [
              { student_id: 'student-1', name: 'A', grade: '10' },
              { student_id: 'student-2', name: 'B', grade: '10' },
            ],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/parent/calendar?student_id=student-2')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            student_id: 'student-2',
            grade: '10',
            range: { from: examDate, to: examDate },
            events: [{
              id: 'exam-1',
              type: 'school_exam',
              date: examDate,
              title: 'Final Assessment',
              subtitle: 'Mathematics',
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the linked URL child and renders live school events without an expired board countdown', async () => {
    render(<ParentCalendarPage />);

    // Generous timeout, not the 1000 ms default: this render awaits TWO chained
    // fetches (children list -> calendar), and under full-suite CPU contention
    // that chain has exceeded 1 s and failed here while passing in isolation.
    // The assertion itself is unchanged — only the wait budget.
    expect(await screen.findByText(/Final Assessment/, undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText(/CBSE Board Exam/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('student_id=student-2'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    }, { timeout: 8000 });
  });
});
