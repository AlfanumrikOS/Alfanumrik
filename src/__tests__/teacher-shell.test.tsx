/**
 * TeacherShell — Plan 1 Task 6.
 *
 * Covers the contracts the teacher portal layout depends on:
 *   1. Renders all 8 nav items in English when authed teacher.
 *   2. Renders Hindi labels when isHi=true.
 *   3. Hides items whose moduleKey resolves to false (assignments=false).
 *   4. Falls through (renders children unwrapped, no <aside>) when not authed
 *      teacher — verified via vi.doMock + dynamic import in an isolated
 *      describe block so the top-level "authed teacher" mocks don't leak.
 *
 * Mock contract notes:
 *   - AuthContext exposes `activeRole` (not `role`). Confirmed by reading
 *     `src/app/teacher/_components/TeacherShell.tsx` line 63.
 *   - The shared <DashboardSidebar> renders both a desktop <aside> (always
 *     mounted) and a mobile drawer <aside> (mounted only when the hamburger
 *     opens it). At test time only the desktop aside is visible, so a plain
 *     `screen.getByText('Dashboard')` is unambiguous. We still scope to the
 *     desktop aside via `within(...)` for clarity and future-proofing.
 *   - The role-gate test uses `vi.doMock` + dynamic import after
 *     `vi.resetModules()` to swap the AuthContext mock without leaking back
 *     into the previous describe. Pattern mirrors
 *     `src/__tests__/regression-subject-leak.test.tsx`.
 */

import { render, screen, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import TeacherShell from '@/app/teacher/_components/TeacherShell';

// ── Default mocks: authed teacher, English ────────────────────────────────
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ authUserId: 'u-1', activeRole: 'teacher', isHi: false }),
}));

vi.mock('@/lib/tenant-context', () => ({
  useTenant: () => ({
    schoolName: 'Test School',
    schoolId: 's-1',
    branding: { logoUrl: null, primaryColor: '#6366F1', showPoweredBy: false },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
  // Editorial Atlas flag pass-through (added 2026-05-11) — the shell reads
  // feature flags on mount to decide between legacy and Atlas chrome.
  // Empty record → isAtlasEnabled() returns false → legacy shell renders.
  getFeatureFlags: vi.fn().mockResolvedValue({}),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/teacher',
}));

// Default fetch — fail-open response (no module overrides). Individual tests
// can override with `(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(...)`.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { modules: [] } }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TeacherShell', () => {
  it('renders all 8 nav items in English when authed teacher', () => {
    render(
      <TeacherShell>
        <div data-testid="page">page content</div>
      </TeacherShell>,
    );

    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    const expectedLabels = [
      'Dashboard',
      'Classes',
      'Students',
      'Assignments',
      'Worksheets',
      'Reports',
      'Lab Leaderboard',
      'Profile',
    ];
    for (const label of expectedLabels) {
      expect(within(desktop).getByText(label)).toBeInTheDocument();
    }

    // Children render inside <main>.
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('renders Hindi labels when isHi=true', async () => {
    vi.resetModules();
    vi.doMock('@/lib/AuthContext', () => ({
      useAuth: () => ({ authUserId: 'u-1', activeRole: 'teacher', isHi: true }),
    }));
    vi.doMock('@/lib/tenant-context', () => ({
      useTenant: () => ({
        schoolName: 'Test School',
        schoolId: 's-1',
        branding: { logoUrl: null, primaryColor: '#6366F1', showPoweredBy: false },
      }),
    }));
    vi.doMock('@/lib/supabase', () => ({
      supabase: { auth: { signOut: vi.fn() } },
      // Editorial Atlas flag pass-through — empty record → legacy renders.
      getFeatureFlags: vi.fn().mockResolvedValue({}),
    }));
    vi.doMock('next/navigation', () => ({
      useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
      usePathname: () => '/teacher',
    }));

    const { default: ShellHi } = await import('@/app/teacher/_components/TeacherShell');
    render(
      <ShellHi>
        <div />
      </ShellHi>,
    );

    const desktop = screen.getByTestId('dashboard-sidebar-desktop');
    // Spot-check a handful of Hindi labels — full coverage of bilingual
    // mapping is the DashboardSidebar primitive's responsibility.
    expect(within(desktop).getByText('डैशबोर्ड')).toBeInTheDocument(); // Dashboard
    expect(within(desktop).getByText('कक्षाएं')).toBeInTheDocument(); // Classes
    expect(within(desktop).getByText('छात्र')).toBeInTheDocument(); // Students
    expect(within(desktop).getByText('प्रोफ़ाइल')).toBeInTheDocument(); // Profile

    // English labels NOT rendered when isHi=true.
    expect(within(desktop).queryByText('Dashboard')).toBeNull();
    expect(within(desktop).queryByText('Classes')).toBeNull();
  });

  it('hides items with disabled moduleKey (assignments=false)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { modules: [{ key: 'assignments', isEnabled: false }] },
      }),
    });

    render(
      <TeacherShell>
        <div />
      </TeacherShell>,
    );

    // Wait for the module-enablement useEffect to settle.
    await new Promise(r => setTimeout(r, 0));

    const desktop = screen.getByTestId('dashboard-sidebar-desktop');

    // "Assignments" (the only item gated by moduleKey: 'assignments') is gone…
    expect(within(desktop).queryByText('Assignments')).toBeNull();

    // …but other items still render (fail-open for unspecified modules).
    expect(within(desktop).getByText('Dashboard')).toBeInTheDocument();
    expect(within(desktop).getByText('Classes')).toBeInTheDocument();
    // Worksheets (lms) and Reports (analytics) are not in our override map,
    // so they remain visible.
    expect(within(desktop).getByText('Worksheets')).toBeInTheDocument();
    expect(within(desktop).getByText('Reports')).toBeInTheDocument();
  });
});

describe('TeacherShell role gate', () => {
  it('falls through (renders children unwrapped, no aside) when not an authed teacher', async () => {
    vi.resetModules();
    vi.doMock('@/lib/AuthContext', () => ({
      useAuth: () => ({ authUserId: null, activeRole: 'none', isHi: false }),
    }));
    vi.doMock('@/lib/tenant-context', () => ({
      useTenant: () => ({
        schoolName: '',
        schoolId: '',
        branding: { logoUrl: null, primaryColor: '#6366F1', showPoweredBy: false },
      }),
    }));
    vi.doMock('@/lib/supabase', () => ({
      supabase: { auth: { signOut: vi.fn() } },
      // Editorial Atlas flag pass-through — empty record → legacy renders.
      getFeatureFlags: vi.fn().mockResolvedValue({}),
    }));
    vi.doMock('next/navigation', () => ({
      useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
      usePathname: () => '/login',
    }));

    const { default: ShellNoAuth } = await import(
      '@/app/teacher/_components/TeacherShell'
    );

    const { container } = render(
      <ShellNoAuth>
        <div data-testid="page">unwrapped</div>
      </ShellNoAuth>,
    );

    // Children rendered…
    expect(container.querySelector('[data-testid="page"]')).toBeInTheDocument();
    // …but the shell didn't wrap them — no sidebar <aside> in the tree.
    expect(container.querySelector('aside')).toBeNull();
  });
});
