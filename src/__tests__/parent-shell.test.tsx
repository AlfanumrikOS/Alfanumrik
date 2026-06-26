/**
 * ParentShell tests — covers the three auth states the shell must handle:
 *
 *   1. guardian mode    — Supabase auth user with activeRole='guardian'.
 *                         All 6 nav items visible.
 *   2. link-code mode   — anonymous link-code login, HMAC payload in
 *                         sessionStorage. Children + Profile are hidden.
 *   3. unauthenticated  — neither auth applies. Shell renders children
 *                         naked (no sidebar) so /parent's login screen
 *                         shows un-wrapped.
 *
 * Pattern: each `describe` block uses `vi.resetModules()` + `vi.doMock()` to
 * swap the AuthContext mock per-suite, then a dynamic `import()` of the
 * ParentShell module so the fresh mock is bound. This is the same pattern
 * Plan 1's teacher-shell tests used.
 */

import { render, screen, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Static mocks shared across all suites ────────────────────────────────
// next/navigation and supabase don't need to vary per-mode, so they're
// declared at the top level (vitest hoists vi.mock).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/parent',
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
  // Editorial Atlas flag pass-through (added 2026-05-11) — the shell reads
  // feature flags on mount to decide between legacy and Atlas chrome. Mock
  // returns an empty record so isAtlasEnabled() resolves false and the
  // legacy shell renders, which is what these tests assert.
  getFeatureFlags: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  sessionStorage.clear();
});

// ────────────────────────────────────────────────────────────────────────
// Suite 1: guardian mode — full Supabase auth, all 6 nav items visible.
// ────────────────────────────────────────────────────────────────────────
describe('ParentShell — guardian mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/AuthContext', () => ({
      useAuth: () => ({ authUserId: 'u-1', activeRole: 'guardian', isHi: false }),
    }));
  });

  it('renders all 6 nav items in the desktop sidebar', async () => {
    const { default: ParentShell } = await import('@/app/parent/_components/ParentShell');
    render(
      <ParentShell>
        <div data-testid="page" />
      </ParentShell>,
    );
    // Wait one tick for the useParentAuth useEffect (async loadParentSession)
    // to resolve. Guardian mode short-circuits before linkCodeChecked but
    // we still wait a tick to let any concurrent state settle.
    const sidebar = await screen.findByTestId('dashboard-sidebar-desktop');
    ['Dashboard', 'Children', 'Calendar', 'Reports', 'Support', 'Profile'].forEach(label => {
      expect(within(sidebar).getByText(label)).toBeInTheDocument();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Suite 2: link-code mode — sessionStorage HMAC payload, no Supabase user.
// Children + Profile must be hidden; Dashboard/Calendar/Reports/Support visible.
// ────────────────────────────────────────────────────────────────────────
describe('ParentShell — link-code mode', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/AuthContext', () => ({
      useAuth: () => ({ authUserId: null, activeRole: 'none', isHi: false }),
    }));
    // Use the real storeParentSession to populate sessionStorage so the
    // HMAC nonce and payload shape match what loadParentSession expects.
    const { storeParentSession } = await import('@/app/parent/_components/parent-session');
    await storeParentSession(
      { id: 'g-1', name: 'P' },
      { id: 's-1', name: 'C', grade: '8' },
    );
  });

  it('shows Dashboard/Calendar/Reports/Support and hides Children + Profile', async () => {
    const { default: ParentShell } = await import('@/app/parent/_components/ParentShell');
    render(
      <ParentShell>
        <div data-testid="page" />
      </ParentShell>,
    );
    // useParentAuth's useEffect runs loadParentSession asynchronously — wait
    // a tick (and a re-render) for the link-code session to be detected.
    const sidebar = await screen.findByTestId('dashboard-sidebar-desktop');
    expect(within(sidebar).getByText('Dashboard')).toBeInTheDocument();
    expect(within(sidebar).getByText('Calendar')).toBeInTheDocument();
    expect(within(sidebar).getByText('Reports')).toBeInTheDocument();
    expect(within(sidebar).getByText('Support')).toBeInTheDocument();
    expect(within(sidebar).queryByText('Children')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Profile')).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Suite 3: unauthenticated — no auth user, no link-code session.
// Shell must render children naked (no <aside>) so /parent's login screen
// can show without a sidebar wrapping it.
// ────────────────────────────────────────────────────────────────────────
describe('ParentShell — unauthenticated', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/AuthContext', () => ({
      useAuth: () => ({ authUserId: null, activeRole: 'none', isHi: false }),
    }));
  });

  it('renders children naked with no sidebar when no auth applies', async () => {
    const { default: ParentShell } = await import('@/app/parent/_components/ParentShell');
    const { container } = render(
      <ParentShell>
        <div data-testid="page" />
      </ParentShell>,
    );
    // Wait for the loadParentSession effect to resolve to null and for the
    // shell to settle into its naked-render branch.
    await new Promise((r) => setTimeout(r, 10));

    expect(container.querySelector('[data-testid="page"]')).toBeInTheDocument();
    expect(container.querySelector('aside')).toBeNull();
  });
});
