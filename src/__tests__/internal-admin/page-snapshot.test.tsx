/**
 * Regression-net snapshot test for /internal/admin/page.tsx
 *
 * Locks down current behaviour BEFORE the Plan 5 decomposition begins:
 *   - Login screen renders when no admin secret is in sessionStorage
 *   - Main shell + tab navigation render once the secret is present
 *   - Tab switching works (clicking Users brings up the User Management heading)
 *
 * Catches "the page crashes" or "tabs disappear" during the refactor.
 *
 * Notes (verified against current page.tsx):
 *   - sessionStorage key is `alfa_admin_secret` (see src/lib/admin-session.ts)
 *   - Admin secret header is `x-admin-secret`
 *   - Tab labels: Command Center, Users, Content CMS, Schools, Revenue,
 *     AI Monitor, Feature Flags, Support, Audit Logs, Reports
 *   - Users tab heading: "User Management"
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Default fetch payload — shaped to keep every tab from crashing on first render.
// The Command tab dereferences command.totals.{students,...}, command.activity.{dau,...},
// command.ai.{calls_last_1h,...}, command.revenue.{today_inr,...}, command.support.open_tickets,
// and command.sparkline (an array). All other tabs use { data: [], total: 0 }.
function makeFetchMock() {
  return vi.fn().mockImplementation((url: string) => {
    let payload: unknown;
    if (typeof url === 'string' && url.includes('/command-center')) {
      payload = {
        totals: {
          students: 0,
          teachers: 0,
          guardians: 0,
          schools: 0,
          premium_students: 0,
          basic_students: 0,
        },
        activity: {
          dau: 0,
          wau: 0,
          new_students_24h: 0,
          new_students_7d: 0,
          quiz_sessions_24h: 0,
          chat_sessions_24h: 0,
        },
        ai: { calls_last_1h: 0, calls_last_24h: 0 },
        revenue: { today_inr: 0, last_7d_inr: 0, last_30d_inr: 0 },
        support: { open_tickets: 0 },
        sparkline: [],
      };
    } else {
      payload = { data: [], total: 0 };
    }
    return Promise.resolve({
      ok: true,
      json: async () => payload,
      blob: async () => new Blob([''], { type: 'application/json' }),
    } as unknown as Response);
  });
}

beforeEach(() => {
  global.fetch = makeFetchMock();
  // Reset module cache so the page's module-level state is fresh per test.
  vi.resetModules();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('Internal admin page regression net', () => {
  it('shows the login screen when no admin secret is stored', async () => {
    // No sessionStorage key — login screen should appear
    const { default: Page } = await import('@/app/internal/admin/page');
    render(<Page />);

    // The login form has an input with placeholder "Admin secret key"
    expect(screen.getByPlaceholderText(/admin secret/i)).toBeInTheDocument();
    // Submit button reads "Access Console" while idle
    expect(screen.getByRole('button', { name: /access console/i })).toBeInTheDocument();
  });

  it('renders the main shell with all tabs after secret is set', async () => {
    // Pre-set the secret BEFORE importing the page so its post-mount useEffect
    // picks it up via getAdminSecretFromSession() and bypasses the login screen.
    sessionStorage.setItem('alfa_admin_secret', 'test-secret');

    const { default: Page } = await import('@/app/internal/admin/page');
    render(<Page />);

    // The page reads the secret in a useEffect (post-mount), so the LoginScreen
    // appears for one render before being replaced. Wait for the Sign Out button
    // to confirm the main shell has rendered.
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    // Sidebar tab labels — the full navigation must be intact
    expect(screen.getByRole('button', { name: /command center/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^[^a-z]*users\s*$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /content cms/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /schools/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revenue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ai monitor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /feature flags/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^[^a-z]*support\s*$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /audit logs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^[^a-z]*reports\s*$/i })).toBeInTheDocument();
  });

  it('switches tabs when a sidebar tab is clicked', async () => {
    sessionStorage.setItem('alfa_admin_secret', 'test-secret');

    const { default: Page } = await import('@/app/internal/admin/page');
    render(<Page />);

    // Wait until past LoginScreen (Sign Out button visible)
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    // Click the Users tab in the sidebar
    const usersTab = screen.getByRole('button', { name: /^[^a-z]*users\s*$/i });
    await act(async () => {
      fireEvent.click(usersTab);
    });

    // Users tab content has a "User Management" heading
    await waitFor(
      () => {
        expect(screen.getByText(/user management/i)).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });
});
