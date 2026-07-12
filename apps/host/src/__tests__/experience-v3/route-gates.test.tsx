import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentV3Gate from '@/app/(student)/_components/StudentV3Gate';

const state = vi.hoisted(() => ({
  enabled: true,
  loading: false,
  capabilities: {},
  manifest: {
    role: 'student' as const,
    homeHref: '/today',
    primary: [],
    more: [],
    desktop: [],
  },
  routeMapped: false,
  routeAllowed: false,
  scope: null,
  legacyAllowed: false,
  denied: false,
}));

vi.mock('@alfanumrik/lib/use-experience-v3', () => ({
  useExperienceV3: () => state,
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'student', isLoading: false }),
}));

vi.mock('@alfanumrik/ui/v3', () => ({
  DataState: ({ state: dataState }: { state: string }) => <div data-testid="data-state">{dataState}</div>,
  ExperienceV3Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RoleShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('V3 page route ownership gate', () => {
  beforeEach(() => {
    Object.assign(state, {
      enabled: true,
      loading: false,
      routeMapped: false,
      routeAllowed: false,
      legacyAllowed: false,
      denied: false,
    });
  });

  it('renders an existing legacy page when V3 does not map its route', () => {
    render(<StudentV3Gate legacy={<p>Legacy destination</p>} v3={<p>V3 destination</p>} />);
    expect(screen.getByText('Legacy destination')).toBeInTheDocument();
    expect(screen.queryByText('V3 destination')).not.toBeInTheDocument();
  });

  it('does not use the legacy page for an authorization denial', () => {
    state.denied = true;
    render(<StudentV3Gate legacy={<p>Legacy destination</p>} v3={<p>V3 destination</p>} />);
    expect(screen.getByTestId('data-state')).toHaveTextContent('permission');
    expect(screen.queryByText('Legacy destination')).not.toBeInTheDocument();
  });

  it('renders V3 only for an explicitly mapped and allowed route', () => {
    state.routeMapped = true;
    state.routeAllowed = true;
    render(<StudentV3Gate legacy={<p>Legacy destination</p>} v3={<p>V3 destination</p>} />);
    expect(screen.getByText('V3 destination')).toBeInTheDocument();
    expect(screen.queryByText('Legacy destination')).not.toBeInTheDocument();
  });
});
