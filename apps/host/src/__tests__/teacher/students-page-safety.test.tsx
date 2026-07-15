import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/teacher/students',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    teacher: { id: 'teacher-1', name: 'Ms Rao' },
    isLoading: false,
    isLoggedIn: true,
    activeRole: 'teacher',
    isHi: false,
  }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'teacher-token' } },
      }),
    },
  },
}));

vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer teacher-token' }),
}));

vi.mock('@alfanumrik/lib/usePermissions', () => ({
  usePermissions: () => ({ can: () => false }),
}));

vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({
  usePulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
}));

vi.mock('@alfanumrik/ui/pulse', () => ({ StudentPulse: () => null }));
vi.mock('@alfanumrik/ui/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

import TeacherStudentsPage from '@/app/teacher/students/page';

const dashboard = {
  classes: [
    {
      id: 'class-a',
      name: 'Grade 7 A',
      student_count: 1,
      students: [
        { id: 'student-a', class_id: 'class-a', name: 'Asha', grade: '7', xp: 250, mastery: 68 },
      ],
    },
    {
      id: 'class-b',
      name: 'Grade 7 B',
      student_count: 2,
      students: [
        { id: 'student-a', class_id: 'class-b', name: 'Asha', grade: '7', xp: 250, mastery: 68 },
        { id: 'student-b', class_id: 'class-b', name: 'Ravi', grade: '7', xp: null, mastery: null },
      ],
    },
  ],
};

function heatmap(classId: string) {
  if (classId === 'class-a') {
    return {
      class_id: classId,
      student_count: 1,
      concept_count: 1,
      concepts: [{ id: 'topic-a', title: 'Fractions', chapter: 1 }],
      matrix: [{
        student_id: 'student-a',
        class_id: classId,
        student_name: 'Asha',
        grade: '7',
        avg_mastery: 72,
        cells: [{ p_know: 0.1, attempts: 10, level: 'low' }],
      }],
    };
  }

  return {
    class_id: classId,
    student_count: 2,
    concept_count: 1,
    concepts: [{ id: 'topic-b', title: 'Decimals', chapter: 1 }],
    matrix: [
      {
        student_id: 'student-a',
        class_id: classId,
        student_name: 'Asha',
        grade: '7',
        avg_mastery: 68,
        cells: [{ p_know: 0.68, attempts: 10, level: 'mid' }],
      },
      {
        student_id: 'student-b',
        class_id: classId,
        student_name: 'Ravi',
        grade: '7',
        avg_mastery: null,
        // Cells alone must not be converted into XP, accuracy, or a client-owned
        // average. The aggregate is explicitly unavailable.
        cells: [{ p_know: 0.9, attempts: 10, level: 'high' }],
      },
    ],
  };
}

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const payload = body.action === 'get_dashboard' ? dashboard : heatmap(body.class_id);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Teacher Students safety contracts', () => {
  it('filters the rendered roster by the server-provided class identity', async () => {
    render(<TeacherStudentsPage />);

    await screen.findByTestId('student-card-student-a-class-a');
    expect(screen.getByTestId('student-card-student-b-class-b')).toBeInTheDocument();
    expect(screen.getByTestId('student-card-student-a-class-b')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'class-b' } });

    await waitFor(() => {
      expect(screen.queryByTestId('student-card-student-a-class-a')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('student-card-student-b-class-b')).toBeInTheDocument();
    expect(screen.getByTestId('student-card-student-a-class-b')).toBeInTheDocument();

    const heatmapClassIds = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(([, init]) => JSON.parse(String(init?.body || '{}')))
      .filter((body) => body.action === 'get_heatmap')
      .map((body) => body.class_id);
    expect(heatmapClassIds).toEqual(['class-a', 'class-b']);
  });

  it('uses stable membership identity when the same student belongs to two classes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<TeacherStudentsPage />);

    expect(await screen.findByTestId('student-card-student-a-class-a')).toBeInTheDocument();
    expect(screen.getByTestId('student-card-student-a-class-b')).toBeInTheDocument();
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes('same key')),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('renders only sourced metrics and uses an em dash for unavailable values', async () => {
    render(<TeacherStudentsPage />);

    const asha = await screen.findByTestId('student-card-student-a-class-a');
    expect(within(asha).getByText('250')).toBeInTheDocument();
    expect(within(asha).getByText('72%')).toBeInTheDocument();
    expect(within(asha).getAllByText('\u2014')).toHaveLength(2);

    const ravi = screen.getByTestId('student-card-student-b-class-b');
    expect(within(ravi).getAllByText('\u2014')).toHaveLength(4);
    expect(within(ravi).queryByText('120')).not.toBeInTheDocument();
    expect(within(ravi).queryByText('90%')).not.toBeInTheDocument();
    expect(within(ravi).queryByText('86%')).not.toBeInTheDocument();

    // No observed low metric means no intervention label.
    expect(screen.queryByText('Needs help')).not.toBeInTheDocument();
  });
});
