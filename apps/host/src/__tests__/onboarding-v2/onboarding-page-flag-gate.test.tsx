/**
 * /onboarding — ff_onboarding_v2 flag-gating (Wave B additive branch).
 *
 * Pins the wiring in apps/host/src/app/onboarding/page.tsx, NOT SetupFlow's
 * own behavior (see components/onboarding/SetupFlow.test.tsx for that):
 *
 *   - flag OFF (or still resolving) → the v1 form renders (v2 never mounts).
 *   - flag ON → the v2 branch mounts and hands SetupFlow the RIGHT student
 *     data (name/grade/board) — verified via a next/dynamic stub spy, since
 *     the real SetupFlow is a code-split component this page must not
 *     re-test.
 *   - not logged in → redirected to /login, regardless of the flag.
 *   - already onboarded → redirected to /dashboard, regardless of the flag
 *     (the v2 branch must never override this existing guard).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const dynamicSpy = vi.fn();
vi.mock('next/dynamic', () => ({
  default: () =>
    function SetupFlowStub(props: Record<string, unknown>) {
      dynamicSpy(props);
      return React.createElement('div', { 'data-testid': 'setup-flow-v2-stub' });
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

vi.mock('@alfanumrik/lib/onboarding/use-setup', () => ({
  useSetup: () => ({
    saving: false,
    saveGrade: vi.fn().mockResolvedValue({ ok: true }),
    saveSubjects: vi.fn().mockResolvedValue({ ok: true }),
    inviteGuardian: vi.fn().mockResolvedValue({ ok: true }),
    finish: vi.fn().mockResolvedValue({ ok: true }),
  }),
  getMinorSignal: vi.fn().mockResolvedValue({ isMinor: false, parentConsentEmail: null }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }) },
}));

vi.mock('@alfanumrik/lib/analytics', () => ({ track: vi.fn() }));

function baseAuth(overrides: Record<string, unknown> = {}) {
  return {
    student: { id: 'student-1', name: 'Aarav', grade: '', board: 'CBSE', onboarding_completed: false },
    isLoggedIn: true,
    isLoading: false,
    refreshStudent: vi.fn(),
    activeRole: 'student',
    isHi: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/onboarding — ff_onboarding_v2 gate', () => {
  it('flag OFF: renders the v1 form, never mounts the v2 stub', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_onboarding_v2: false }, isLoading: false });

    const { default: OnboardingPage } = await import('@/app/onboarding/page');
    render(<OnboardingPage />);

    await screen.findByText(/Welcome to Alfanumrik/i);
    expect(screen.queryByTestId('setup-flow-v2-stub')).not.toBeInTheDocument();
    expect(dynamicSpy).not.toHaveBeenCalled();
  });

  it('flag still resolving: holds on the v1 loading state, does not flash v2', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: undefined, isLoading: true });

    const { default: OnboardingPage } = await import('@/app/onboarding/page');
    render(<OnboardingPage />);

    expect(screen.queryByTestId('setup-flow-v2-stub')).not.toBeInTheDocument();
  });

  it('flag ON: mounts the v2 branch and passes the correct student identity to SetupFlow', async () => {
    mockUseAuth.mockReturnValue(
      baseAuth({ student: { id: 'student-9', name: 'Diya', grade: '8', board: 'ICSE', onboarding_completed: false } }),
    );
    mockUseFeatureFlags.mockReturnValue({ data: { ff_onboarding_v2: true }, isLoading: false });

    const { default: OnboardingPage } = await import('@/app/onboarding/page');
    render(<OnboardingPage />);

    await screen.findByTestId('setup-flow-v2-stub');
    await waitFor(() => expect(dynamicSpy).toHaveBeenCalled());
    const props = dynamicSpy.mock.calls[dynamicSpy.mock.calls.length - 1][0];
    expect(props.studentName).toBe('Diya');
    expect(props.initialGrade).toBe('8');
    expect(props.initialBoard).toBe('ICSE');
  });

  it('not logged in: redirects to /login regardless of the flag', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ isLoggedIn: false, student: null }));
    mockUseFeatureFlags.mockReturnValue({ data: { ff_onboarding_v2: true }, isLoading: false });

    const { default: OnboardingPage } = await import('@/app/onboarding/page');
    render(<OnboardingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('setup-flow-v2-stub')).not.toBeInTheDocument();
  });

  it('already onboarded: redirects to /dashboard, the v2 branch never overrides this guard', async () => {
    mockUseAuth.mockReturnValue(
      baseAuth({ student: { id: 'student-1', name: 'Aarav', grade: '9', board: 'CBSE', onboarding_completed: true } }),
    );
    mockUseFeatureFlags.mockReturnValue({ data: { ff_onboarding_v2: true }, isLoading: false });

    const { default: OnboardingPage } = await import('@/app/onboarding/page');
    render(<OnboardingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByTestId('setup-flow-v2-stub')).not.toBeInTheDocument();
  });
});
