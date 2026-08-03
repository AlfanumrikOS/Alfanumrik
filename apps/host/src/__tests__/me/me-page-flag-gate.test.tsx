/**
 * /me — ff_me_v2 flag-gating (Wave B additive route).
 *
 * Pins the wiring in apps/host/src/app/me/page.tsx, NOT ProfileScreen's own
 * behavior (see components/profile/ProfileScreen.test.tsx for that):
 *
 *   - flag OFF (or still resolving) → redirects to /profile (the existing,
 *     already-shipped equivalent), same "route doesn't exist yet" shape as
 *     /tests redirecting to /today when ff_exam_schedule_v1 is off.
 *   - flag ON → mounts ProfileScreen with the RIGHT stats (snapshot takes
 *     priority over the raw student row, same precedence the legacy
 *     /profile page already uses).
 *   - not logged in → redirected to /login, regardless of the flag.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const dynamicSpy = vi.fn();
vi.mock('next/dynamic', () => ({
  default: () =>
    function ProfileScreenStub(props: Record<string, unknown>) {
      dynamicSpy(props);
      return React.createElement('div', { 'data-testid': 'me-profile-screen-stub' });
    },
}));

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
}));

const mockUseAuth = vi.fn();
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseFeatureFlags = vi.fn();
vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => mockUseFeatureFlags(),
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ unlocked: [], locked: [], subjects: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/offline/use-offline-state', () => ({
  useOfflineState: () => ({ isOffline: false, chapters: [{ id: 'c1' }], pending: [], savedExplanations: [{ id: 's1' }, { id: 's2' }], refresh: vi.fn() }),
}));

const mockSupabaseSingle = vi.fn().mockResolvedValue({ data: { invite_code: 'XYZ123' } });
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: mockSupabaseSingle, not: () => ({ limit: () => ({ single: mockSupabaseSingle }) }) }) }),
    }),
  },
}));

function baseAuth(overrides: Record<string, unknown> = {}) {
  return {
    isHi: false,
    isLoading: false,
    isLoggedIn: true,
    student: {
      id: 'student-1',
      name: 'Aarav',
      grade: '9',
      board: 'CBSE',
      school_name: 'DAV School',
      city: 'Delhi',
      state: 'Delhi',
      subscription_plan: 'free',
      parent_name: null,
      parent_phone: null,
      selected_subjects: ['math'],
      xp_total: 100,
      streak_days: 2,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    snapshot: { total_xp: 900, current_streak: 5, topics_mastered: 4, quizzes_taken: 12 },
    language: 'en',
    setLanguage: vi.fn(),
    refreshStudent: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabaseSingle.mockResolvedValue({ data: { invite_code: 'XYZ123' } });
});

describe('/me — ff_me_v2 gate', () => {
  it('flag OFF: redirects to /profile (the existing equivalent), never mounts ProfileScreen', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_me_v2: false }, isLoading: false });

    const { default: MePage } = await import('@/app/me/page');
    render(<MePage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/profile'));
    expect(screen.queryByTestId('me-profile-screen-stub')).not.toBeInTheDocument();
  });

  it('flag still resolving: does not redirect and does not mount ProfileScreen yet', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: undefined, isLoading: true });

    const { default: MePage } = await import('@/app/me/page');
    render(<MePage />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('me-profile-screen-stub')).not.toBeInTheDocument();
  });

  it('flag ON: mounts ProfileScreen and prefers the snapshot over the raw student row for stats', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_me_v2: true }, isLoading: false });

    const { default: MePage } = await import('@/app/me/page');
    render(<MePage />);

    await screen.findByTestId('me-profile-screen-stub');
    const props = dynamicSpy.mock.calls[dynamicSpy.mock.calls.length - 1][0];
    // snapshot.total_xp (900) wins over student.xp_total (100) — same
    // precedence the legacy /profile page already uses.
    expect(props.stats).toEqual({ totalXp: 900, streak: 5, mastered: 4, quizzesTaken: 12 });
    expect(props.student.name).toBe('Aarav');
    expect(props.downloadsCount).toBe(1);
    expect(props.savedExplanationsCount).toBe(2);
  });

  it('flag ON: falls back to the raw student row when snapshot is absent', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ snapshot: null }));
    mockUseFeatureFlags.mockReturnValue({ data: { ff_me_v2: true }, isLoading: false });

    const { default: MePage } = await import('@/app/me/page');
    render(<MePage />);

    await screen.findByTestId('me-profile-screen-stub');
    const props = dynamicSpy.mock.calls[dynamicSpy.mock.calls.length - 1][0];
    expect(props.stats.totalXp).toBe(100);
    expect(props.stats.streak).toBe(2);
  });

  it('not logged in: redirects to /login regardless of the flag', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ isLoggedIn: false, student: null }));
    mockUseFeatureFlags.mockReturnValue({ data: { ff_me_v2: true }, isLoading: false });

    const { default: MePage } = await import('@/app/me/page');
    render(<MePage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('me-profile-screen-stub')).not.toBeInTheDocument();
  });
});
