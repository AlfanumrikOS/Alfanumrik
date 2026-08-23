import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

/**
 * Phase 5B Surface 2 — i18n sweep.
 * Guards that the /auth/reset page renders the correct language strings
 * based on AuthContext.isHi. Password-reset is a P15-adjacent flow.
 *
 * ── WAITING STRATEGY (rewritten 2026-08-23, CI merge-gate flake fix) ────────
 *
 * WHAT WAS WRONG. `apps/host/src/app/auth/reset/page.tsx` polls
 * `supabase.auth.getSession()` on a REAL 500 ms `setInterval` and only paints
 * the invalid-link state once its own `MAX_WAIT_MS = 8000` budget is exhausted
 * (page.tsx:57). This file used to sit through all 8 of those seconds on the
 * real clock, guarded by a `waitFor(..., { timeout: 9500 })` and a per-test
 * `}, 15000)` literal that SHADOWED the global `testTimeout: 120000`
 * (vitest.config.ts). That leaves a 1.5 s margin on an 8 s wall — about 19%.
 *
 * `Unit Tests (shard N/4)` runs four vitest processes in parallel on one CI
 * box. Under that starvation the 16 poll ticks stretch well past 8 s of wall
 * clock (each tick has to re-enter JSDOM + React + a promise chain while three
 * other shards fight for the same cores), the run blows through 15 s, and the
 * test dies as `Error: Test timed out in 15000ms` — measured 6/6 failures under
 * a loaded reproduction on 2026-08-23. It is a harness calibration bug, not a
 * product defect: the page is behaving exactly as designed.
 *
 * WHAT IT DOES NOW. Fake timers. `drainSessionPoll()` consumes the page's
 * entire 8 s poll budget in VIRTUAL time, so this file spends ~0 real seconds
 * waiting and cannot be starved by a loaded box. The per-test `}, 15000)`
 * literals are gone, so the file inherits the global `testTimeout` and a
 * genuine hang still fails with a real error instead of an anonymous timeout.
 *
 * NOTHING IS WEAKENED. Every assertion below is the same assertion, in the
 * same order, against the same DOM: the page still has to actually reach the
 * invalid-link state, still has to render it in the right language, and still
 * has to render NO string from the other language. The only thing that changed
 * is which clock the 8 s of page-internal waiting is measured on.
 *
 * DO NOT re-introduce a per-test timeout literal here. If the page's poll
 * budget changes, change PAGE_POLL_BUDGET_MS — that is virtual time and costs
 * nothing.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({}) }),
  },
}));

const mockIsHi = { value: false };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

// ── The page's own poll contract (apps/host/src/app/auth/reset/page.tsx) ─────
// POLL_INTERVAL_MS and MAX_WAIT_MS are declared inside the page's effect and
// are not exported, so they are mirrored here. Both are advanced on the FAKE
// clock, so these numbers cost zero wall-clock seconds.
const POLL_INTERVAL_MS = 500;
const PAGE_POLL_BUDGET_MS = 8000;
// Two ticks past the page's own budget so the final `elapsed >= MAX_WAIT_MS`
// branch (which is what calls `setChecking(false)`) definitely runs.
const DRAIN_TICKS = PAGE_POLL_BUDGET_MS / POLL_INTERVAL_MS + 2;

/**
 * Advance the fake clock one page-poll interval at a time until `settled()`
 * reports the DOM has reached its terminal state, or the page's own budget is
 * exhausted. Stepping (rather than one big jump) is what lets each interval
 * callback's `await supabase.auth.getSession()` continuation run between ticks.
 */
async function drainSessionPoll(settled: () => boolean): Promise<void> {
  for (let i = 0; i < DRAIN_TICKS; i++) {
    if (settled()) return;
    // eslint-disable-next-line no-await-in-loop -- ticks are strictly ordered
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
  }
}

afterEach(() => {
  // Unmount while the fake clock is still installed so the page's effect
  // cleanup clears its interval against the same clock that created it.
  cleanup();
  vi.useRealTimers();
});

describe('/auth/reset — i18n (P7)', () => {
  it('renders English copy by default (isHi = false)', async () => {
    mockIsHi.value = false;
    vi.resetModules();
    // Imported BEFORE the fake clock is installed: module resolution is real
    // I/O and has nothing to do with the page's poll.
    const { default: ResetPasswordPage } = await import('@/app/auth/reset/page');

    vi.useFakeTimers();
    render(<ResetPasswordPage />);
    await drainSessionPoll(() => screen.queryByText(/invalid or expired link/i) !== null);

    expect(screen.getByText(/invalid or expired link/i)).toBeTruthy();
    expect(screen.getByText(/this password reset link has expired/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /go to login/i })).toBeTruthy();
    // No Hindi string should appear
    expect(screen.queryByText(/अमान्य/)).toBeNull();
  });

  it('renders Hindi copy when isHi = true', async () => {
    mockIsHi.value = true;
    vi.resetModules();
    const { default: ResetPasswordPage } = await import('@/app/auth/reset/page');

    vi.useFakeTimers();
    render(<ResetPasswordPage />);
    await drainSessionPoll(() => screen.queryByText(/अमान्य या समाप्त लिंक/) !== null);

    expect(screen.getByText(/अमान्य या समाप्त लिंक/)).toBeTruthy();
    expect(screen.getByText(/यह पासवर्ड रीसेट लिंक समाप्त हो चुका है/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /लॉगिन पर जाएँ/ })).toBeTruthy();
    // No English string should appear for the localized copy
    expect(screen.queryByText(/invalid or expired link/i)).toBeNull();
  });
});
