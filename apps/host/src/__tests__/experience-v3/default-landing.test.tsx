import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  activeRole: 'student',
  authLoading: false,
  v3: {
    enabled: true,
    loading: false,
    capabilities: {},
    manifest: {
      role: 'student' as const,
      homeHref: '/today',
      primary: [{ label: 'Today', href: '/today', capability: 'student.today', exact: true }],
      more: [],
      desktop: [{ label: 'Today', href: '/today', capability: 'student.today', exact: true }],
    },
    routeMapped: true,
    routeAllowed: true,
    scope: null,
    legacyAllowed: false,
    denied: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('next/dynamic', () => ({
  default: () => function MockLegacyDashboard() {
    return <div data-testid="legacy-dashboard">Legacy dashboard</div>;
  },
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ activeRole: mocks.activeRole, isLoading: mocks.authLoading }),
}));

vi.mock('@alfanumrik/lib/use-experience-v3', () => ({
  useExperienceV3: () => mocks.v3,
}));

vi.mock('@alfanumrik/ui/Skeleton', () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton">Loading</div>,
}));

vi.mock('@alfanumrik/ui/v3', () => ({
  DataState: ({ state }: { state: string }) => <div data-testid="data-state">{state}</div>,
}));

import Dashboard from '@/app/(student)/dashboard/page';

describe('student default V3 landing', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.activeRole = 'student';
    mocks.authLoading = false;
    Object.assign(mocks.v3, {
      enabled: true,
      loading: false,
      routeMapped: true,
      routeAllowed: true,
      legacyAllowed: false,
      denied: false,
      manifest: {
        role: 'student' as const,
        homeHref: '/today',
        primary: [{ label: 'Today', href: '/today', capability: 'student.today', exact: true }],
        more: [],
        desktop: [{ label: 'Today', href: '/today', capability: 'student.today', exact: true }],
      },
    });
  });

  it('replaces the legacy default with the canonical home for an authorized V3 assignment', async () => {
    render(<Dashboard />);

    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-dashboard')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/today'));
  });

  it('renders legacy when the role flag is explicitly off', () => {
    Object.assign(mocks.v3, { enabled: false, legacyAllowed: true, routeMapped: false, routeAllowed: false, manifest: null });

    render(<Dashboard />);

    expect(screen.getByTestId('legacy-dashboard')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('preserves an unmapped legacy landing instead of forcing V3', () => {
    mocks.v3.routeMapped = false;

    render(<Dashboard />);

    expect(screen.getByTestId('legacy-dashboard')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('fails closed when server authorization denies the assignment', () => {
    Object.assign(mocks.v3, { enabled: false, denied: true, routeMapped: false, routeAllowed: false, manifest: null });

    render(<Dashboard />);

    expect(screen.getByTestId('data-state')).toHaveTextContent('permission');
    expect(screen.queryByTestId('legacy-dashboard')).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('fails closed for a user whose active role is not student', () => {
    mocks.activeRole = 'teacher';

    render(<Dashboard />);

    expect(screen.getByTestId('data-state')).toHaveTextContent('permission');
    expect(screen.queryByTestId('legacy-dashboard')).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical home was removed by capability filtering', () => {
    mocks.v3.manifest = { role: 'student', homeHref: '/today', primary: [], more: [], desktop: [] };

    render(<Dashboard />);

    expect(screen.getByTestId('data-state')).toHaveTextContent('permission');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
