/**
 * nav-config — isNavItemActive (RCA W2).
 *
 * Pins the shared active-state matcher every student nav projection uses
 * (DesktopSidebar + MobileBottomNav). Regression guard: both components used
 * to inline `pathname.startsWith(href)` — a prefix match with NO segment
 * boundary — so `/me` lit up on `/memory` and `/mock-exam`, and any shorter
 * href matched any longer sibling route. The helper must keep descendant
 * pages active (`/learn/math/1` → `/learn`) while forbidding cross-route
 * prefix collisions.
 */
import { describe, it, expect } from 'vitest';
import { isNavItemActive } from '@alfanumrik/ui/navigation/nav-config';

describe('nav-config — isNavItemActive', () => {
  it('marks an exact route active', () => {
    expect(isNavItemActive('/progress', '/progress')).toBe(true);
    expect(isNavItemActive('/foxy', '/foxy')).toBe(true);
  });

  it('keeps descendant pages active for the parent route (nested route support)', () => {
    expect(isNavItemActive('/learn/math/1', '/learn')).toBe(true);
    expect(isNavItemActive('/progress/overview', '/progress')).toBe(true);
  });

  it('does NOT treat a longer sibling as a descendant — segment boundary required', () => {
    // The RCA W2 regressions, pinned one by one.
    expect(isNavItemActive('/memory', '/me')).toBe(false);
    expect(isNavItemActive('/mock-exam', '/me')).toBe(false);
    expect(isNavItemActive('/mock-exam', '/mock')).toBe(false);
    expect(isNavItemActive('/revision', '/rev')).toBe(false);
  });

  it('treats the root href as exact-match-only', () => {
    expect(isNavItemActive('/', '/')).toBe(true);
    expect(isNavItemActive('/dashboard', '/')).toBe(false);
  });
});
