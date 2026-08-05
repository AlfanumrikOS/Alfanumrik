/**
 * D9 (Foxy North-Star Phase 2) — "How Foxy explains" settings section.
 *
 * Pins:
 *   - current values load from student_learning_profiles (RLS-scoped client
 *     read) and drive the selected pills;
 *   - a pill tap PATCHes /api/learner/preferences with the camelCase
 *     contract body ({ learningStyle } / { preferredExplanationDepth }),
 *     optimistically updating the UI;
 *   - any failure (network error, 404 while the wave-2b route is pending,
 *     5xx) rolls the selection back and surfaces an error toast;
 *   - the enum values sent are EXACTLY the fixed contract set:
 *     visual | verbal | example-first | balanced and quick | medium | deep.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────

const authState = {
  student: { id: 'student-1', name: 'Asha Kumar', email: 'asha@example.com', grade: '9', board: 'CBSE' },
  isLoggedIn: true,
  isLoading: false,
  isHi: false,
  language: 'en',
  setLanguage: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@alfanumrik/ui/ui', () => ({
  LoadingFoxy: () => <div data-testid="loading-foxy" />,
}));

vi.mock('@alfanumrik/lib/sanitize', () => ({
  validatePassword: () => ({ valid: true, error: '' }),
  PASSWORD_MIN_LENGTH: 8,
}));

// Row returned by the student_learning_profiles read (mutable per test).
let profileRow: { learning_style: string | null; preferred_explanation_depth: string | null } | null = null;
const fromCalls: string[] = [];

vi.mock('@alfanumrik/lib/supabase', () => {
  function makeChain(table: string) {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    (chain as Record<string, unknown>).maybeSingle = vi.fn(async () => ({
      data: table === 'student_learning_profiles' ? profileRow : null,
      error: null,
    }));
    return chain;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        return makeChain(table);
      }),
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        signInWithPassword: vi.fn(),
        updateUser: vi.fn(),
        signOut: vi.fn(),
        resetPasswordForEmail: vi.fn(),
      },
    },
  };
});

// ─── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  profileRow = null;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderSettings() {
  const { default: SettingsPage } = await import('@/app/settings/page');
  render(<SettingsPage />);
  await screen.findByTestId('pref-style-balanced');
}

const isPressed = (testId: string) =>
  screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Settings — D9 How Foxy explains', () => {
  it('defaults to balanced / medium and loads stored values from the profile row', async () => {
    profileRow = { learning_style: 'visual', preferred_explanation_depth: 'deep' };
    await renderSettings();
    await waitFor(() => expect(isPressed('pref-style-visual')).toBe(true));
    expect(isPressed('pref-depth-deep')).toBe(true);
    expect(isPressed('pref-style-balanced')).toBe(false);
    expect(fromCalls).toContain('student_learning_profiles');
  });

  it('falls back to safe defaults when the stored value is outside the contract enum', async () => {
    profileRow = { learning_style: 'astrology', preferred_explanation_depth: null };
    await renderSettings();
    await waitFor(() => expect(fromCalls).toContain('student_learning_profiles'));
    expect(isPressed('pref-style-balanced')).toBe(true);
    expect(isPressed('pref-depth-medium')).toBe(true);
  });

  it('PATCHes /api/learner/preferences with the camelCase contract body on tap (optimistic)', async () => {
    await renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByTestId('pref-style-example-first'));
    });
    expect(isPressed('pref-style-example-first')).toBe(true); // optimistic
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c: unknown[]) => String(c[0]) === '/api/learner/preferences');
      expect(calls).toHaveLength(1);
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe('PATCH');
      expect(init.credentials).toBe('same-origin');
      expect(JSON.parse(String(init.body))).toEqual({ learningStyle: 'example-first' });
    });
    // Stays selected after success.
    expect(isPressed('pref-style-example-first')).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByTestId('pref-depth-quick'));
    });
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c: unknown[]) => String(c[0]) === '/api/learner/preferences');
      expect(calls).toHaveLength(2);
      expect(JSON.parse(String(calls[1][1].body))).toEqual({ preferredExplanationDepth: 'quick' });
    });
  });

  it('rolls back the selection and shows an error toast on failure (e.g. 404 until wave 2b lands)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await renderSettings();
    expect(isPressed('pref-style-balanced')).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId('pref-style-verbal'));
    });
    await waitFor(() => {
      // Rolled back to the previous value…
      expect(isPressed('pref-style-verbal')).toBe(false);
      expect(isPressed('pref-style-balanced')).toBe(true);
      // …with an error toast.
      expect(screen.getByRole('status').textContent).toMatch(/Could not save/);
    });
  });

  it('rolls back on network error too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByTestId('pref-depth-deep'));
    });
    await waitFor(() => {
      expect(isPressed('pref-depth-deep')).toBe(false);
      expect(isPressed('pref-depth-medium')).toBe(true);
    });
  });
});
