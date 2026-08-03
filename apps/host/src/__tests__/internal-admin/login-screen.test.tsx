/**
 * Unit tests for the extracted LoginScreen component.
 *
 * P2-1 PR-2 changed the login contract: the console now requires TWO
 * credentials before onLogin() fires —
 *   1. a super_admin SESSION (email + password → POST /api/super-admin/login,
 *      credentials:'same-origin'; the 200 sets an httpOnly cookie, no tokens
 *      in the body), and
 *   2. the shared admin SECRET (validated, unchanged, via GET
 *      /api/internal/admin/stats with the x-admin-secret header).
 *
 * These tests assert:
 *  - The secret input + "Access Console" button still render (pinned strings).
 *  - onLogin(secret) fires only after BOTH steps succeed, and the secret is
 *    persisted to sessionStorage under the canonical key.
 *  - A rejected secret shows the "denied" error and does NOT call onLogin.
 *  - A failed session login surfaces the server error and never reaches the
 *    secret step.
 *  - A network error is surfaced and does not call onLogin.
 *  - The submit button stays disabled until all three fields are provided
 *    (both-required gating).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import LoginScreen from '@/app/internal/admin/_components/LoginScreen';

type FetchMock = ReturnType<typeof vi.fn>;

/** Fill all three credential fields with the given values. */
function fillCredentials(email: string, password: string, secret: string) {
  fireEvent.change(screen.getByPlaceholderText(/administrator email/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByPlaceholderText(/administrator password/i), {
    target: { value: password },
  });
  fireEvent.change(screen.getByPlaceholderText(/admin secret/i), {
    target: { value: secret },
  });
}

function clickAccessConsole() {
  fireEvent.click(
    screen.getByRole('button', { name: /access console|login|sign in/i }),
  );
}

beforeEach(() => {
  global.fetch = vi.fn();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('LoginScreen', () => {
  it('renders an admin secret input + submit button', () => {
    render(<LoginScreen onLogin={() => {}} />);
    expect(screen.getByPlaceholderText(/admin secret/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /access console|login|sign in/i }),
    ).toBeInTheDocument();
  });

  it('calls onLogin with secret after BOTH session login and secret validation succeed', async () => {
    (global.fetch as FetchMock).mockImplementation((url: string) => {
      if (url === '/api/super-admin/login') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      // /api/internal/admin/stats
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fillCredentials('admin@alfa.com', 'pw', 's3cret');
    clickAccessConsole();

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('s3cret'));

    // Session step: POST /api/super-admin/login with email/password body and
    // credentials:'same-origin' (so the server can set the sb-* cookie).
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/super-admin/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ email: 'admin@alfa.com', password: 'pw' }),
      }),
    );
    // Secret step: GET /api/internal/admin/stats with the lowercase
    // x-admin-secret header (unchanged from the pre-PR-2 flow).
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/internal/admin/stats',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-admin-secret': 's3cret' }),
      }),
    );
    // Persists secret to sessionStorage under the canonical key.
    expect(sessionStorage.getItem('alfa_admin_secret')).toBe('s3cret');
  });

  it('shows an error and does not call onLogin when the secret is rejected', async () => {
    (global.fetch as FetchMock).mockImplementation((url: string) => {
      if (url === '/api/super-admin/login') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      // Secret validation fails.
      return Promise.resolve({ ok: false, status: 401, text: async () => 'invalid' });
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fillCredentials('admin@alfa.com', 'pw', 'wrong');
    clickAccessConsole();

    await waitFor(() => {
      expect(screen.getByText(/invalid|wrong|denied/i)).toBeInTheDocument();
    });
    expect(onLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('alfa_admin_secret')).toBeNull();
  });

  it('surfaces the server error and never validates the secret when session login fails', async () => {
    (global.fetch as FetchMock).mockImplementation((url: string) => {
      if (url === '/api/super-admin/login') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fillCredentials('admin@alfa.com', 'badpw', 's3cret');
    clickAccessConsole();

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
    expect(onLogin).not.toHaveBeenCalled();
    // The secret endpoint must NOT be reached if the session login fails.
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/internal/admin/stats',
      expect.anything(),
    );
    expect(sessionStorage.getItem('alfa_admin_secret')).toBeNull();
  });

  it('shows network error on fetch rejection', async () => {
    (global.fetch as FetchMock).mockRejectedValue(new Error('boom'));
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fillCredentials('admin@alfa.com', 'pw', 'x');
    clickAccessConsole();

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled until all three credentials are provided', () => {
    render(<LoginScreen onLogin={() => {}} />);
    const button = screen.getByRole('button', { name: /access console/i });
    expect(button).toBeDisabled();

    // Secret alone is not enough — the session credentials are also required.
    fireEvent.change(screen.getByPlaceholderText(/admin secret/i), {
      target: { value: 's3cret' },
    });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/administrator email/i), {
      target: { value: 'admin@alfa.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/administrator password/i), {
      target: { value: 'pw' },
    });
    expect(button).toBeEnabled();
  });
});
