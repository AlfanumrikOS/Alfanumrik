/**
 * Unit tests for the internal-admin LoginScreen component.
 *
 * P2-1 PR-4 made the console SESSION-ONLY: the sole credential is the
 * super_admin SESSION — email + password POSTed to /api/super-admin/login with
 * credentials:'same-origin'. On 200 the server sets an httpOnly sb-* cookie
 * (no tokens in the body) and onLogin() fires. The former shared admin secret
 * (its input, its GET /api/internal/admin/stats validation, and its
 * sessionStorage persistence) was removed end-to-end.
 *
 * These tests assert:
 *  - Email + password inputs + the "Access Console" button render.
 *  - There is NO admin-secret input any more.
 *  - onLogin() fires (with no argument) after the session login succeeds, and
 *    the request is POST /api/super-admin/login with credentials:'same-origin'
 *    and an {email, password} body — no secret validation call, no
 *    x-admin-secret header, nothing written to sessionStorage.
 *  - A failed session login surfaces the server error and never calls onLogin.
 *  - A network error is surfaced and does not call onLogin.
 *  - The submit button stays disabled until BOTH email and password are given.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import LoginScreen from '@/app/internal/admin/_components/LoginScreen';

type FetchMock = ReturnType<typeof vi.fn>;

/** Fill the two credential fields with the given values. */
function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText(/administrator email/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByPlaceholderText(/administrator password/i), {
    target: { value: password },
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

describe('LoginScreen (session-only)', () => {
  it('renders email + password inputs and the submit button, with NO secret field', () => {
    render(<LoginScreen onLogin={() => {}} />);
    expect(screen.getByPlaceholderText(/administrator email/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/administrator password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /access console|login|sign in/i }),
    ).toBeInTheDocument();
    // The shared-secret input is gone.
    expect(screen.queryByPlaceholderText(/admin secret/i)).not.toBeInTheDocument();
  });

  it('calls onLogin after the session login succeeds (session-only, no secret step)', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fillCredentials('admin@alfa.com', 'pw');
    clickAccessConsole();

    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    // onLogin now takes no argument (there is no secret to hand back).
    expect(onLogin).toHaveBeenCalledWith();

    // The ONLY request is POST /api/super-admin/login with the credential body
    // and credentials:'same-origin' so the server can set the sb-* cookie.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/super-admin/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ email: 'admin@alfa.com', password: 'pw' }),
      }),
    );
    // The legacy secret-validation endpoint must NOT be called any more.
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/internal/admin/stats',
      expect.anything(),
    );
    // Nothing is persisted client-side (the session lives in an httpOnly cookie).
    expect(sessionStorage.getItem('alfa_admin_secret')).toBeNull();
  });

  it('surfaces the server error and does not call onLogin when session login fails', async () => {
    (global.fetch as FetchMock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' }),
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fillCredentials('admin@alfa.com', 'badpw');
    clickAccessConsole();

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
    expect(onLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('alfa_admin_secret')).toBeNull();
  });

  it('shows network error on fetch rejection', async () => {
    (global.fetch as FetchMock).mockRejectedValue(new Error('boom'));
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fillCredentials('admin@alfa.com', 'pw');
    clickAccessConsole();

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled until both email and password are provided', () => {
    render(<LoginScreen onLogin={() => {}} />);
    const button = screen.getByRole('button', { name: /access console/i });
    expect(button).toBeDisabled();

    // Email alone is not enough.
    fireEvent.change(screen.getByPlaceholderText(/administrator email/i), {
      target: { value: 'admin@alfa.com' },
    });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/administrator password/i), {
      target: { value: 'pw' },
    });
    expect(button).toBeEnabled();
  });
});
