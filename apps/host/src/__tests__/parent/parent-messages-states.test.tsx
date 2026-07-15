import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ParentMessagesPage from '@/app/parent/messages/page';

const testState = vi.hoisted(() => ({
  query: '',
  router: { replace: vi.fn(), push: vi.fn() },
  children: {
    data: undefined as unknown,
    error: undefined as unknown,
    isLoading: false,
    mutate: vi.fn(),
  },
  threads: {
    data: undefined as unknown,
    error: undefined as unknown,
    isLoading: false,
    mutate: vi.fn(),
  },
  messages: {
    data: undefined as unknown,
    error: undefined as unknown,
    isLoading: false,
    mutate: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => testState.router,
  usePathname: () => '/parent/messages',
  useSearchParams: () => new URLSearchParams(testState.query),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    isHi: false,
    authUserId: 'guardian-user-1',
    activeRole: 'guardian',
  }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/api/v2/parent/children') return testState.children;
    if (key?.startsWith('/api/parent/messages/threads?student_id=')) return testState.threads;
    return testState.messages;
  },
}));

const thread = (id: string, studentId: string, teacherName: string) => ({
  id,
  teacher_id: `teacher-${id}`,
  guardian_id: 'guardian-1',
  student_id: studentId,
  school_id: 'school-1',
  subject: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  last_message_at: '2026-07-01T00:00:00.000Z',
  teacher_name: teacherName,
  student_name: studentId,
  last_message_preview: null,
  last_message_sender_role: null,
  unread_count: 0,
});

describe('parent messages states', () => {
  beforeEach(() => {
    testState.query = 'childId=student-1';
    Object.assign(testState.children, {
      data: {
        success: true,
        data: {
          children: [
            { student_id: 'student-1', name: 'One', grade: '7' },
            { student_id: 'student-2', name: 'Two', grade: '8' },
          ],
        },
      },
      error: undefined,
      isLoading: false,
    });
    Object.assign(testState.threads, { data: undefined, error: undefined, isLoading: false });
    Object.assign(testState.messages, { data: undefined, error: undefined, isLoading: false });
    testState.children.mutate.mockReset();
    testState.threads.mutate.mockReset();
    testState.messages.mutate.mockReset();
    testState.router.replace.mockReset();
    testState.router.push.mockReset();
  });

  it('shows a recoverable error instead of a false empty conversation list', () => {
    testState.threads.error = new Error('network');
    render(<ParentMessagesPage />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load conversations.");
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(testState.threads.mutate).toHaveBeenCalledOnce();
  });

  it('shows only authorized threads for the child carried in the URL', () => {
    testState.query = 'childId=student-2';
    testState.threads.data = {
      success: true,
      threads: [thread('thread-1', 'student-1', 'Teacher One'), thread('thread-2', 'student-2', 'Teacher Two')],
      unreadTotal: 0,
    };
    testState.messages.data = { success: true, messages: [], nextCursor: null };

    render(<ParentMessagesPage />);

    expect(screen.getAllByText('Teacher Two').length).toBeGreaterThan(0);
    expect(screen.queryByText('Teacher One')).not.toBeInTheDocument();
  });

  it('normalizes an unknown childId using the authoritative linked-child response', async () => {
    testState.query = 'childId=foreign-student&thread=foreign-thread';
    testState.threads.data = {
      success: true,
      threads: [thread('thread-1', 'student-1', 'Teacher One')],
      unreadTotal: 0,
    };

    render(<ParentMessagesPage />);

    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Switching to an available child');
    await waitFor(() => {
      expect(testState.router.replace).toHaveBeenCalledWith('/parent/messages?childId=student-1');
    });
  });

  it('shows a recoverable child-scope error instead of an empty inbox', () => {
    testState.children.data = undefined;
    testState.children.error = new Error('network');

    render(<ParentMessagesPage />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load child access.");
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(testState.children.mutate).toHaveBeenCalledOnce();
  });
});
