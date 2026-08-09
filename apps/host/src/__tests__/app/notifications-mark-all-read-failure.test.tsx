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
  // ServiceResult envelope — getStudentNotifications no longer resolves the
  // bare payload (a failure and an empty inbox used to be the same value).
  getStudentNotifications.mockResolvedValue({
    ok: true,
    data: { unread_count: 1, notifications: [UNREAD] },
  });
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

/* ═══════════════════════════════════════════════════════════════════════════
   Quality review follow-up (2026-08-09) — the LOAD path.

   `getStudentNotifications` resolved `{ unread_count: 0, notifications: [] }`
   for BOTH a genuine empty inbox and a failed RPC, and the page's `catch` was
   dead code (supabase.rpc() resolves, it does not reject). Net effect: after a
   500 the student was told "No notifications yet" / "अभी तक कोई सूचना नहीं" —
   the same lie /progress told with "No knowledge gaps detected!" and the exact
   counter-example that disproved the TODO(backend) claim in supabase.ts.

   BOTH DIRECTIONS are asserted. A failure-only suite would also pass against a
   build that simply deleted the empty state — which is a different wrong
   product, since a real first-run student has an empty inbox.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('/notifications — load failure vs genuinely empty inbox', () => {
  const FAILURE = { ok: false, error: 'getStudentNotifications: rpc denied', code: 'DB_ERROR' };
  const EMPTY = { ok: true, data: { unread_count: 0, notifications: [] } };

  it('a FAILED read shows the error card and NOT "No notifications yet"', async () => {
    getStudentNotifications.mockResolvedValue(FAILURE);
    await renderPage();

    await waitFor(() =>
      expect(screen.getByText('Failed to load notifications')).toBeInTheDocument(),
    );
    // The reassuring claim must be ABSENT, not merely accompanied.
    expect(screen.queryByText('No notifications yet')).toBeNull();
    expect(screen.queryByText('अभी तक कोई सूचना नहीं')).toBeNull();
    // Logged with a reason and no PII (P13) — never swallowed.
    expect(loggerWarn).toHaveBeenCalledWith(
      'notifications: get_student_notifications failed',
      expect.objectContaining({ reason: expect.stringContaining('rpc denied') }),
    );
    const [, meta] = loggerWarn.mock.calls[0];
    expect(JSON.stringify(meta)).not.toContain('stu-1');
  });

  it('a GENUINELY EMPTY inbox shows "No notifications yet" and NO error card', async () => {
    getStudentNotifications.mockResolvedValue(EMPTY);
    await renderPage();

    await waitFor(() => expect(screen.getByText('No notifications yet')).toBeInTheDocument());
    expect(screen.queryByText('Failed to load notifications')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('the failure copy is bilingual (P7)', async () => {
    mockIsHi = true;
    getStudentNotifications.mockResolvedValue(FAILURE);
    await renderPage();

    await waitFor(() =>
      expect(screen.getByText('सूचनाएं लोड नहीं हो सकीं')).toBeInTheDocument(),
    );
    expect(screen.getByText('पुनः प्रयास')).toBeInTheDocument();
    expect(screen.queryByText('अभी तक कोई सूचना नहीं')).toBeNull();
  });

  it('Retry re-reads and recovers to the real list', async () => {
    getStudentNotifications.mockResolvedValueOnce(FAILURE);
    getStudentNotifications.mockResolvedValue({
      ok: true,
      data: { unread_count: 1, notifications: [UNREAD] },
    });
    await renderPage();

    await waitFor(() =>
      expect(screen.getByText('Failed to load notifications')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => expect(screen.getByText(UNREAD.title)).toBeInTheDocument());
    expect(screen.queryByText('Failed to load notifications')).toBeNull();
  });

  it('a failed REFRESH keeps last-known-good rather than blanking the list', async () => {
    getStudentNotifications.mockResolvedValueOnce({
      ok: true,
      data: { unread_count: 1, notifications: [UNREAD] },
    });
    getStudentNotifications.mockResolvedValue(FAILURE);
    await renderPage();

    await waitFor(() => expect(screen.getByText(UNREAD.title)).toBeInTheDocument());
    // Force a refresh through the same loader the error card's Retry uses.
    fireEvent.click(screen.getByText(UNREAD.title));

    // The row the student was reading survives; the failure is reported next
    // to it rather than replacing it with an empty (or reassuring) screen.
    await waitFor(() => expect(screen.getByText(UNREAD.title)).toBeInTheDocument());
    expect(screen.queryByText('No notifications yet')).toBeNull();
  });

  it('declares the 44px touch floor on the Retry control (WCAG 2.5.8)', async () => {
    getStudentNotifications.mockResolvedValue(FAILURE);
    await renderPage();

    await waitFor(() =>
      expect(screen.getByText('Failed to load notifications')).toBeInTheDocument(),
    );
    // Declaration only — JSDOM loads no stylesheet, so getComputedStyle here
    // returns '' for min-height and can prove nothing about layout. The REAL
    // measurement is e2e/ui-error-states.spec.ts, which reads boundingBox() at
    // nine viewports; that is the layer that caught /progress's 42px control,
    // and this assertion deliberately does not pretend to replace it. Same
    // two-layer split as progress-data-load-error.test.ts:405.
    const retry = screen.getByText('Retry').closest('button')!;
    expect(retry.className).toContain('min-h-[44px]');
    expect(retry.className).toContain('min-w-[44px]');
  });
});
