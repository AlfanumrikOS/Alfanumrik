/**
 * Unit tests for the extracted LoginScreen component.
 *
 * Confirms behaviour preserved from the original inline LoginScreen in
 * src/app/internal/admin/page.tsx:
 *  - Renders the admin secret input + submit button.
 *  - Hits /api/internal/admin/stats with the x-admin-secret header.
 *  - Calls onLogin(secret) on success and writes sessionStorage.
 *  - Shows an "access denied" error on 401 / non-OK responses.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import LoginScreen from '@/app/internal/admin/_components/LoginScreen';

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

  it('calls onLogin with secret on successful submit', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText(/admin secret/i), {
      target: { value: 's3cret' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /access console|login|sign in/i }),
    );

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('s3cret'));
    // Validation hits the stats endpoint with the lowercase x-admin-secret header.
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/internal/admin/stats',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-admin-secret': 's3cret' }),
      }),
    );
    // Persists secret to sessionStorage under the canonical key.
    expect(sessionStorage.getItem('alfa_admin_secret')).toBe('s3cret');
  });

  it('shows error on bad secret and does not call onLogin', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid',
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText(/admin secret/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /access console|login|sign in/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/invalid|wrong|denied/i)).toBeInTheDocument();
    });
    expect(onLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('alfa_admin_secret')).toBeNull();
  });

  it('shows network error on fetch rejection', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fireEvent.change(screen.getByPlaceholderText(/admin secret/i), {
      target: { value: 'x' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /access console|login|sign in/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
    expect(onLogin).not.toHaveBeenCalled();
  });
});
