import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Phase 5B Surface 2 — i18n sweep.
 * Guards that the /auth/reset page renders the correct language strings
 * based on AuthContext.isHi. Password-reset is a P15-adjacent flow.
 *
 * Strategy: the page has a 2-second fallback timer before rendering the
 * invalid-link state when no session is found. We use real timers and a
 * longer per-test timeout so the assertions observe the final DOM.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase', () => ({
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
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

describe('/auth/reset — i18n (P7)', () => {
  it('renders English copy by default (isHi = false)', async () => {
    mockIsHi.value = false;
    vi.resetModules();
    const { default: ResetPasswordPage } = await import('@/app/auth/reset/page');
    render(<ResetPasswordPage />);
    await waitFor(
      () => expect(screen.getByText(/invalid or expired link/i)).toBeTruthy(),
      { timeout: 3500 },
    );
    expect(screen.getByText(/this password reset link has expired/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /go to login/i })).toBeTruthy();
    // No Hindi string should appear
    expect(screen.queryByText(/अमान्य/)).toBeNull();
  }, 10000);

  it('renders Hindi copy when isHi = true', async () => {
    mockIsHi.value = true;
    vi.resetModules();
    const { default: ResetPasswordPage } = await import('@/app/auth/reset/page');
    render(<ResetPasswordPage />);
    await waitFor(
      () => expect(screen.getByText(/अमान्य या समाप्त लिंक/)).toBeTruthy(),
      { timeout: 3500 },
    );
    expect(screen.getByText(/यह पासवर्ड रीसेट लिंक समाप्त हो चुका है/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /लॉगिन पर जाएँ/ })).toBeTruthy();
    // No English string should appear for the localized copy
    expect(screen.queryByText(/invalid or expired link/i)).toBeNull();
  }, 10000);
});