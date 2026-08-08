/**
 * /notifications — "Mark all read" failure is SURFACED, not swallowed.
 *
 * Frontend audit, Phase 3 Wave A
 *   `markAllRead` previously ended in `} catch {}`. Worse, `supabase.rpc()`
 *   RESOLVES with `{ data, error }` rather than rejecting, so the catch was
 *   dead code anyway and the optimistic local update ran even when the server
 *   had rejected the write — the badge cleared and every row went grey while
 *   nothing had actually been marked read. On the next load they all came
 *   back unread.
 *
 *   Now the `error` field is inspected: on failure the local state is left
 *   untouched (the unread badge stays honest) and a bilingual toast tells the
 *   student to retry. On success the optimistic update still applies.
 *
 *   Harness mirrors student-notifications-prerequisite-types.test.tsx.
 */

import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const student = { id: 'stu-1', grade: '8' };
let mockIsHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ student, isLoggedIn: true, isLoading: false, isHi: mockIsHi }),
}));

const getStudentNotifications = vi.fn();
const rpc = vi.fn();
vi.mock('@alfanumrik/lib/supabase', () => ({
  getStudentNotifications: (...args: unknown[]) => getStudentNotifications(...args),
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const toastError = vi.fn();
vi.mock('@alfanumrik/ui/ui/toast', () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

const loggerWarn = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const UNREAD = {
  id: 'n-1',
  type: 'quiz_result',
  title: 'You scored 80% in Science',
  body: 'Nice work — keep the streak going.',
  data: {},
  is_read: false,
  created_at: new Date().toISOString(),
};

async function renderPage() {
  const { default: NotificationsPage } = await import('@/app/notifications/page');
  return render(React.createElement(NotificationsPage));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsHi = false;
  getStudentNotifications.mockResolvedValue({ unread_count: 1, notifications: [UNREAD] });
});

afterEach(() => {
  cleanup();
});

describe('/notifications — mark all read', () => {
  it('surfaces a bilingual error and keeps the unread badge when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await renderPage();

    await waitFor(() => expect(screen.getByText('Mark all read')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith("Couldn't mark all as read. Please try again.");
    // Logged, not swallowed.
    expect(loggerWarn).toHaveBeenCalled();
    // The unread badge must NOT have optimistically cleared — the server said no.
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });

  it('shows the Hindi toast when isHi is true (P7)', async () => {
    mockIsHi = true;
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await renderPage();

    await waitFor(() => expect(screen.getByText('सब पढ़ा')).toBeInTheDocument());
    fireEvent.click(screen.getByText('सब पढ़ा'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('सब पढ़ा हुआ मार्क नहीं हो सका। फिर से कोशिश करो।');
  });

  it('applies the optimistic update and shows no error when the RPC succeeds', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await renderPage();

    await waitFor(() => expect(screen.getByText('Mark all read')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Mark all read'));

    // unreadCount → 0 hides both the badge and the "Mark all read" affordance.
    await waitFor(() => expect(screen.queryByText('Mark all read')).toBeNull());
    expect(toastError).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Quality review follow-up — Finding #4
   `markRead` (the tap-through path) failed SILENTLY: it logged and returned
   with no student-visible feedback, while its sibling `markAllRead` toasted.
   Two different answers to the same question ("the write was rejected — now
   what?"). These pin ONE pattern across both paths: same logger.warn + toast
   pair, same bilingual copy register, and local state untouched either way.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('/notifications — mark ONE read (tap-through)', () => {
  it('surfaces a toast and keeps the row unread when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await renderPage();

    await waitFor(() => expect(screen.getByText(UNREAD.title)).toBeInTheDocument());
    fireEvent.click(screen.getByText(UNREAD.title));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith("Couldn't mark that as read. Please try again.");
    // Logged, not swallowed — same shape as markAllRead.
    expect(loggerWarn).toHaveBeenCalled();
    // No fake success: the unread badge / affordance must survive the failure.
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });

  it('shows the Hindi toast when isHi is true (P7)', async () => {
    mockIsHi = true;
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await renderPage();

    await waitFor(() => expect(screen.getByText(UNREAD.title)).toBeInTheDocument());
    fireEvent.click(screen.getByText(UNREAD.title));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('सूचना पढ़ी हुई मार्क नहीं हो सकी। फिर से कोशिश करो।');
  });

  it('applies the optimistic update and shows no toast when the RPC succeeds', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await renderPage();

    await waitFor(() => expect(screen.getByText(UNREAD.title)).toBeInTheDocument());
    fireEvent.click(screen.getByText(UNREAD.title));

    // unreadCount 1 → 0 hides the "Mark all read" affordance.
    await waitFor(() => expect(screen.queryByText('Mark all read')).toBeNull());
    expect(toastError).not.toHaveBeenCalled();
  });

  it('gives BOTH paths the same failure feedback (consistency — Finding #4)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await renderPage();

    await waitFor(() => expect(screen.getByText(UNREAD.title)).toBeInTheDocument());

    fireEvent.click(screen.getByText(UNREAD.title));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));

    // Same channel, same register — neither path is silent.
    for (const [message] of toastError.mock.calls) {
      expect(String(message)).toMatch(/^Couldn't mark .* Please try again\.$/);
    }
    expect(loggerWarn).toHaveBeenCalledTimes(2);
  });
});
