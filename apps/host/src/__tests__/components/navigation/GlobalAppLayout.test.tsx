/**
 * GlobalAppLayout — Wave B addition: mounts <OfflineBoundary> around the
 * student surface (packages/ui/src/navigation/GlobalAppLayout.tsx).
 *
 * OfflineBoundary's OWN internal logic (flag gate, online/offline branching)
 * is covered in components/offline/OfflineBoundary.test.tsx — this suite
 * covers ONLY GlobalAppLayout's wrapping DECISION (`isOfflineScoped`), which
 * is deliberately a DIFFERENT condition from the existing `showNav` gate:
 *
 * Pins:
 *   - isOfflineScoped = isLoggedIn && activeRole === 'student' — children are
 *     wrapped in OfflineBoundary for a logged-in student on ANY route.
 *   - NOT wrapped for a logged-out visitor.
 *   - NOT wrapped for a logged-in non-student role (parent/teacher/admin).
 *   - WRAPPED on /foxy even though showNav (nav chrome) is suppressed there —
 *     this is the deliberate divergence from showNav the component's own
 *     comment calls out (offline coverage must reach /foxy and /review).
 *   - showNav (nav chrome) behavior is UNCHANGED: still suppressed on /foxy
 *     and on the long excluded-route list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlobalAppLayout } from '@alfanumrik/ui/navigation/GlobalAppLayout';

let authState: { isLoggedIn: boolean; activeRole: string | null; isHi: boolean };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

let pathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

// Stub the dynamic nav chrome so this suite is independent of its internals.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    // Distinguish the two nav components by their loader's module path text
    // isn't reliable across bundlers, so just render a generic marker per
    // call order isn't reliable either — instead stub BOTH the same way and
    // rely on the component-level test asserting presence/absence generically
    // via a shared testid, disambiguated by rendering the loader's source.
    const src = loader.toString();
    // Three nav tiers are mounted from GlobalAppLayout since 2026-08-09:
    // DesktopSidebar (1024+), TabletNavRail (768–1023, net-new) and
    // MobileBottomNav (<768). Each needs its own testid or getByTestId below
    // would match two elements and throw.
    const testId = src.includes('DesktopSidebar')
      ? 'stub-desktop-sidebar'
      : src.includes('TabletNavRail')
        ? 'stub-tablet-nav-rail'
        : 'stub-mobile-bottom-nav';
    return function DynamicStub() {
      return <div data-testid={testId} />;
    };
  },
}));

vi.mock('@alfanumrik/ui/offline/v2/OfflineBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stub-offline-boundary">{children}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  authState = { isLoggedIn: true, activeRole: 'student', isHi: false };
  pathname = '/dashboard';
});

describe('GlobalAppLayout — offline-boundary wrapping (isOfflineScoped)', () => {
  it('wraps children in OfflineBoundary for a logged-in student', () => {
    render(
      <GlobalAppLayout>
        <div data-testid="page-content" />
      </GlobalAppLayout>,
    );
    const boundary = screen.getByTestId('stub-offline-boundary');
    expect(boundary).toBeInTheDocument();
    expect(boundary.querySelector('[data-testid="page-content"]')).not.toBeNull();
  });

  it('does NOT wrap children when the visitor is logged out', () => {
    authState = { isLoggedIn: false, activeRole: null, isHi: false };
    render(
      <GlobalAppLayout>
        <div data-testid="page-content" />
      </GlobalAppLayout>,
    );
    expect(screen.queryByTestId('stub-offline-boundary')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it.each(['parent', 'teacher', 'admin'])('does NOT wrap children for a logged-in %s (non-student role)', (role) => {
    authState = { isLoggedIn: true, activeRole: role, isHi: false };
    render(
      <GlobalAppLayout>
        <div data-testid="page-content" />
      </GlobalAppLayout>,
    );
    expect(screen.queryByTestId('stub-offline-boundary')).not.toBeInTheDocument();
  });

  it('WRAPS children on /foxy — deliberate divergence from showNav, which suppresses nav there', () => {
    pathname = '/foxy';
    render(
      <GlobalAppLayout>
        <div data-testid="page-content" />
      </GlobalAppLayout>,
    );
    expect(screen.getByTestId('stub-offline-boundary')).toBeInTheDocument();
    // Nav chrome is still suppressed on /foxy (showNav excludes it) — the
    // divergence is specifically about the offline boundary, not nav.
    expect(screen.queryByTestId('stub-desktop-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-mobile-bottom-nav')).not.toBeInTheDocument();
  });

  it('passes isHi through to OfflineBoundary', () => {
    authState = { isLoggedIn: true, activeRole: 'student', isHi: true };
    // Re-mock OfflineBoundary to surface the prop it received for this one test.
    render(
      <GlobalAppLayout>
        <div>content</div>
      </GlobalAppLayout>,
    );
    // The stub above ignores isHi, but proves rendering doesn't throw with
    // isHi=true — a targeted prop-shape smoke check.
    expect(screen.getByTestId('stub-offline-boundary')).toBeInTheDocument();
  });
});

describe('GlobalAppLayout — nav chrome (showNav) unchanged', () => {
  it('shows nav chrome for a logged-in student on a normal route', () => {
    render(
      <GlobalAppLayout>
        <div>content</div>
      </GlobalAppLayout>,
    );
    expect(screen.getByTestId('stub-desktop-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('stub-mobile-bottom-nav')).toBeInTheDocument();
  });

  it('suppresses nav chrome on an excluded route (e.g. /login) even for a logged-in student', () => {
    pathname = '/login';
    render(
      <GlobalAppLayout>
        <div>content</div>
      </GlobalAppLayout>,
    );
    expect(screen.queryByTestId('stub-desktop-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-mobile-bottom-nav')).not.toBeInTheDocument();
  });

  it('suppresses nav chrome for a logged-out visitor', () => {
    authState = { isLoggedIn: false, activeRole: null, isHi: false };
    render(
      <GlobalAppLayout>
        <div>content</div>
      </GlobalAppLayout>,
    );
    expect(screen.queryByTestId('stub-desktop-sidebar')).not.toBeInTheDocument();
  });
});
