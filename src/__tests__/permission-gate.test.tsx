import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mock usePermissions ──
const mockCan = vi.fn();
vi.mock('@/lib/usePermissions', () => ({
  usePermissions: () => ({
    can: mockCan,
    loading: false,
    roles: ['student'],
    permissions: [],
    hasPermission: mockCan,
    hasRole: vi.fn(),
    isAdmin: false,
    isTeacher: false,
    isParent: false,
    isStudent: true,
  }),
}));

// ── Mock useAuth ──
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    isHi: false,
    isLoggedIn: true,
    isLoading: false,
    activeRole: 'student',
    roles: ['student'],
    authUserId: 'test-user',
    student: null,
    snapshot: null,
    teacher: null,
    guardian: null,
    setActiveRole: vi.fn(),
    isDemoUser: false,
    language: 'en',
    setLanguage: vi.fn(),
    theme: 'system',
    toggleTheme: vi.fn(),
    refreshStudent: vi.fn(),
    refreshSnapshot: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import PermissionGate from '@/components/PermissionGate';

describe('PermissionGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Test 1: Renders children when permission granted ────────

  it('renders children when permission is granted', () => {
    mockCan.mockReturnValue(true);

    render(
      <PermissionGate permission="quiz.attempt">
        <div data-testid="child">Allowed content</div>
      </PermissionGate>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Allowed content')).toBeInTheDocument();
  });

  // ─── Test 2: Hides when denied + fallback='hide' ────────────

  it('hides content when denied with fallback=hide', () => {
    mockCan.mockReturnValue(false);

    const { container } = render(
      <PermissionGate permission="admin.manage_users" fallback="hide">
        <div data-testid="child">Secret content</div>
      </PermissionGate>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(container.innerHTML).toBe('');
  });

  // ─── Test 3: Shows lock when denied + fallback='lock' ───────

  it('shows lock UI when denied with fallback=lock', () => {
    mockCan.mockReturnValue(false);

    render(
      <PermissionGate permission="admin.manage_users" fallback="lock">
        <div data-testid="child">Secret content</div>
      </PermissionGate>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByText('This feature is locked')).toBeInTheDocument();
  });

  // ─── Test 4: Shows upgrade CTA when denied + fallback='upgrade' ──

  it('shows upgrade CTA when denied with fallback=upgrade', () => {
    mockCan.mockReturnValue(false);

    render(
      <PermissionGate
        permission="admin.manage_users"
        fallback="upgrade"
        planRequired="Pro"
      >
        <div data-testid="child">Secret content</div>
      </PermissionGate>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByText(/Available in Pro/)).toBeInTheDocument();
    expect(screen.getByText('Upgrade')).toBeInTheDocument();

    // Check the upgrade link points to /billing
    const link = screen.getByText('Upgrade');
    expect(link.closest('a')).toHaveAttribute('href', '/billing');
  });

  // ─── Test 5: Defaults to 'hide' when no fallback ───────────

  it('defaults to hide when no fallback is specified', () => {
    mockCan.mockReturnValue(false);

    const { container } = render(
      <PermissionGate permission="admin.manage_users">
        <div data-testid="child">Secret content</div>
      </PermissionGate>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(container.innerHTML).toBe('');
  });

  // ─── Test 6: Custom lock message ────────────────────────────

  it('shows custom lock message when provided', () => {
    mockCan.mockReturnValue(false);

    render(
      <PermissionGate
        permission="quiz.attempt"
        fallback="lock"
        lockMessage="Please subscribe to access quizzes"
      >
        <div>Quiz</div>
      </PermissionGate>,
    );

    expect(
      screen.getByText('Please subscribe to access quizzes'),
    ).toBeInTheDocument();
  });
});
